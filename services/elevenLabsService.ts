import { ElevenLabsVoice } from '../types';
import { appLogger } from '../utils/logger';

const API_BASE_URL = 'https://api.elevenlabs.io/v1';

export const getVoices = async (apiKey: string): Promise<ElevenLabsVoice[]> => {
  if (!apiKey) {
    throw new Error('ElevenLabs API key is required.');
  }

  appLogger.add('API_REQUEST', 'elevenLabsService.getVoices', { url: `${API_BASE_URL}/voices` });
  const response = await fetch(`${API_BASE_URL}/voices`, {
    headers: {
      'xi-api-key': apiKey,
    },
  });

  if (!response.ok) {
    let errorMsg = `Failed to fetch ElevenLabs voices: ${response.statusText}`;
    try {
        const errorData = await response.json();
        errorMsg = `Failed to fetch ElevenLabs voices: ${errorData.detail?.message || response.statusText}`;
    } catch (e) {
        // Ignore if response is not json
    }
    throw new Error(errorMsg);
  }

  const data = await response.json();
  const voices = data.voices.map((voice: any) => ({
    id: voice.voice_id,
    name: `${voice.name} (${voice.labels.gender}, ${voice.labels.accent})`,
  }));

  appLogger.add('API_RESPONSE', 'elevenLabsService.getVoices SUCCESS', { voiceCount: voices.length });
  return voices;
};

export const generateVoiceOver = async (
  apiKey: string,
  text: string,
  voiceId: string
): Promise<string> => {
  if (!apiKey) {
    throw new Error('ElevenLabs API key is required.');
  }
  if (!text) {
    throw new Error('Text for voice over cannot be empty.');
  }
  if (!voiceId) {
    throw new Error('A voice must be selected.');
  }

  const payload = {
    text: text,
    model_id: 'eleven_multilingual_v2',
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75,
    },
  };
  appLogger.add('API_REQUEST', 'elevenLabsService.generateVoiceOver', { url: `${API_BASE_URL}/text-to-speech/${voiceId}`, payload });

  const response = await fetch(`${API_BASE_URL}/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let errorMsg = `Failed to generate voice over: ${response.statusText}`;
    try {
      const errorData = await response.json();
      errorMsg = `Failed to generate voice over: ${errorData.detail?.message || response.statusText}`;
    } catch (e) {
      // Ignore if response is not json
    }
    throw new Error(errorMsg);
  }

  const blob = await response.blob();
  appLogger.add('API_RESPONSE', 'elevenLabsService.generateVoiceOver SUCCESS', { blobSize: blob.size, blobType: blob.type });
  return URL.createObjectURL(blob);
};
