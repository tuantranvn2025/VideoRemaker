
// Since mp4box is loaded from a script tag in index.html, we declare it to satisfy TypeScript.
declare const MP4Box: any;

interface MP4BoxInfo {
  duration: number;
  timescale: number;
  tracks: any[];
  [key: string]: any;
}

// A helper function to get video metadata using mp4box.js
const getInfo = (buffer: ArrayBuffer): Promise<MP4BoxInfo> => {
  return new Promise((resolve, reject) => {
    const mp4boxfile = MP4Box.createFile();
    mp4boxfile.onError = reject;
    mp4boxfile.onReady = (info: MP4BoxInfo) => {
        if (!info.tracks || info.tracks.length === 0) {
            return reject(new Error("Invalid video file: No tracks found."));
        }
        resolve(info);
    };
    
    // mp4box.js requires a 'fileStart' property on the buffer.
    const bufferCopy = buffer.slice(0);
    (bufferCopy as any).fileStart = 0;
    mp4boxfile.appendBuffer(bufferCopy);
  });
};

// A helper function to extract all media samples from a video buffer.
const getSamples = (buffer: ArrayBuffer): Promise<any[]> => {
    return new Promise((resolve, reject) => {
        const mp4boxfile = MP4Box.createFile();
        let trackId: number;
        const allSamples: any[] = [];

        mp4boxfile.onError = reject;
        
        mp4boxfile.onReady = (info: MP4BoxInfo) => {
            if (!info.tracks || info.tracks.length === 0) {
                return reject(new Error("Invalid video file: No tracks found for sample extraction."));
            }
            trackId = info.tracks[0].id;
            mp4boxfile.setExtractionOptions(trackId, null, { nbSamples: info.tracks[0].nb_samples });
            mp4boxfile.start();
        };

        mp4boxfile.onSamples = (id: number, user: any, samples: any[]) => {
            allSamples.push(...samples);
        };
        
        mp4boxfile.onFlush = () => {
             resolve(allSamples);
        };

        const bufferCopy = buffer.slice(0);
        (bufferCopy as any).fileStart = 0;
        mp4boxfile.appendBuffer(bufferCopy);
        mp4boxfile.flush();
    });
};

/**
 * Cuts a video into multiple segments of a specified duration.
 * This implementation is optimized to be memory-efficient and performant by processing the source video in a single pass.
 * It avoids loading all video samples into memory at once, instead distributing them to the appropriate clip as they are parsed.
 * @param videoBuffer An ArrayBuffer of the video file.
 * @param segmentDuration The duration of each clip in seconds.
 * @returns A promise that resolves to an array of objects containing the Blob URL and name for each clip.
 */
export const cutVideo = async (videoBuffer: ArrayBuffer, segmentDuration: number): Promise<{url: string, name: string}[]> => {
    return new Promise(async (resolve, reject) => {
        try {
            const originalInfo = await getInfo(videoBuffer);
            const tracks = originalInfo.tracks;
            const totalDurationInSeconds = originalInfo.duration / originalInfo.timescale;
            if (totalDurationInSeconds <= 0) {
                throw new Error("Invalid video duration.");
            }
            const numSegments = Math.ceil(totalDurationInSeconds / segmentDuration);

            // 1. Create an array of segment files, one for each clip, and prepare track mappings.
            const segmentFiles: any[] = [];
            const trackIdMap = new Map<number, number[]>();
            for (let i = 0; i < numSegments; i++) {
                segmentFiles.push(MP4Box.createFile());
            }
            for (const track of tracks) {
                const newTrackIds: number[] = [];
                for (const segmentFile of segmentFiles) {
                    // Initialize corresponding tracks in each segment file.
                    const newId = segmentFile.addTrack({ ...track, nb_samples: 0, duration: 0 });
                    newTrackIds.push(newId);
                }
                trackIdMap.set(track.id, newTrackIds);
            }

            // 2. Create the main file processor that will parse the video buffer once.
            const mainFile = MP4Box.createFile();
            mainFile.onError = reject;

            mainFile.onReady = (info: MP4BoxInfo) => {
                // For each track in the source file, set extraction options to get all samples.
                for (const track of info.tracks) {
                    mainFile.setExtractionOptions(track.id, null, { nbSamples: track.nb_samples });
                }
                mainFile.start();
            };

            // 3. As samples are extracted, distribute them to the correct segment file.
            mainFile.onSamples = (trackId: number, user: any, samples: any[]) => {
                const track = tracks.find(t => t.id === trackId);
                if (!track) return;

                const timescale = track.timescale;
                const newTrackIds = trackIdMap.get(trackId);
                if (!newTrackIds) return;

                for (const sample of samples) {
                    // Determine which segment this sample belongs to based on its timestamp.
                    const sampleTimeInSeconds = sample.dts / timescale;
                    const segmentIndex = Math.floor(sampleTimeInSeconds / segmentDuration);
                    
                    if (segmentIndex >= 0 && segmentIndex < numSegments) {
                        const segmentFile = segmentFiles[segmentIndex];
                        const newTrackId = newTrackIds[segmentIndex];
                        const segmentStartTimeInTimescale = segmentIndex * segmentDuration * timescale;

                        // Copy the sample, adjust its timestamps to be relative to the new clip, and add it.
                        // The .slice() is crucial as mp4box reuses the underlying buffer.
                        const newSample = { ...sample, data: sample.data.slice(0) };
                        newSample.dts -= segmentStartTimeInTimescale;
                        newSample.cts -= segmentStartTimeInTimescale;
                        segmentFile.addSample(newTrackId, newSample.data, newSample);
                    }
                }
            };

            // 4. When the main file is fully parsed, finalize each segment file and create blob URLs.
            mainFile.onFlush = () => {
                const clipUrls: {url: string, name: string}[] = [];
                for (let i = 0; i < segmentFiles.length; i++) {
                    const segmentBuffer = segmentFiles[i].getBuffer();
                    if (segmentBuffer.byteLength > 0) {
                        const blob = new Blob([segmentBuffer], { type: 'video/mp4' });
                        const url = URL.createObjectURL(blob);
                        clipUrls.push({ url, name: `clip_${String(i + 1).padStart(2, '0')}.mp4` });
                    }
                }
                
                if(clipUrls.length === 0 && numSegments > 0) {
                    reject(new Error("Failed to extract any clips from the video. It may be corrupted."));
                } else {
                    resolve(clipUrls);
                }
            };

            // 5. Start the process.
            const bufferCopy = videoBuffer.slice(0);
            (bufferCopy as any).fileStart = 0;
            mainFile.appendBuffer(bufferCopy);
            mainFile.flush();
        } catch (error) {
            reject(error);
        }
    });
};

/**
 * Combines multiple video clips into a single MP4 file.
 * @param videoUrls An array of Blob URLs for the video clips to combine.
 * @returns A promise that resolves to a new Blob URL for the combined video.
 */
export const combineVideos = async (videoUrls: string[]): Promise<string> => {
  if (videoUrls.length === 0) throw new Error("No videos to combine.");
  if (videoUrls.length === 1) return videoUrls[0];

  const outputFile = MP4Box.createFile();
  let accumulatedDuration = 0;

  // 1. Get info from the first video to create a compatible track in the output file.
  const firstVideoBuffer = await fetch(videoUrls[0]).then(res => res.arrayBuffer());
  const firstVideoInfo = await getInfo(firstVideoBuffer);
  const firstTrack = firstVideoInfo.tracks[0];
  
  // Add a track to the new file, copying essential properties from the first video's track.
  const newTrackId = outputFile.addTrack({
    ...firstTrack,
    // Overwrite properties that should be specific to the new combined file.
    id: 1, // Start with track ID 1.
    created: new Date(),
    modified: new Date(),
    nb_samples: 0, // We will add samples manually.
    duration: 0, // Will be accumulated.
  });

  // 2. Process each video clip in order.
  for (const url of videoUrls) {
    const buffer = await fetch(url).then(res => res.arrayBuffer());
    const info = await getInfo(buffer);
    const samples = await getSamples(buffer);

    for (const sample of samples) {
        // Offset the timestamps (DTS and CTS) by the duration of the videos already added.
        // This is the core logic for stitching clips together.
        sample.dts += accumulatedDuration;
        sample.cts += accumulatedDuration;
        outputFile.addSample(newTrackId, sample.data, sample);
    }
    
    // The duration in the info object is in timescale units, which is what we need to offset DTS/CTS.
    accumulatedDuration += info.duration;
  }
  
  // 3. Get the final MP4 file as a buffer and create a downloadable Blob URL.
  const finalBuffer = outputFile.getBuffer();
  const blob = new Blob([finalBuffer], { type: 'video/mp4' });
  return URL.createObjectURL(blob);
};
