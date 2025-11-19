
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AnalyzedCharacter, Character, Scene, VideoSettings, FinalVideoMeta, AspectRatio, VideoQuality, StoryConcept, ScenePrompt, EvolvingAsset, VideoAnalysis, ElevenLabsVoice } from './types';
import * as geminiService from './services/geminiService';
import * as elevenLabsService from './services/elevenLabsService';
import { fileToBase64 } from './utils/fileUtils';
import * as videoUtils from './utils/videoUtils';
import { UploadIcon, SparklesIcon, FilmIcon, TrashIcon, DownloadIcon, RefreshIcon, EyeIcon, KeyIcon, SaveIcon, YouTubeIcon, UsersIcon, BookOpenIcon, InformationCircleIcon, CheckCircleIcon, LightningBoltIcon, DiamondIcon, PaintBrushIcon, PhotographIcon, QuestionMarkCircleIcon } from './components/icons';
import Loader from './components/Loader';
import ProgressBar from './components/ProgressBar';
import NotificationContainer, { Notification } from './components/Notification';
import { appLogger } from './utils/logger';
import LogPanel from './components/LogPanel';
import { mergeBuffers, showSaveDialog, saveBase64File, openFlowAuth } from './services/electronApi';
import { validateApiKey } from './services/geminiService';

const LOCAL_STORAGE_KEY = 'aiVideoProject';
const ELEVENLABS_API_KEY_STORAGE = 'elevenLabsApiKey';

const FAILED_PREVIEW_PLACEHOLDER = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNjAiIGhlaWdodD0iOTAiIHZpZXdCb3g9IjAgMCAxNjAgOTAiPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9IiM0QTU1NjgiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IiNFMkU4RjAiIHRleHQtYW5jaGyPSJtaWRkbGUiIGRvbWluYW50LWJhc2VsaW5lPSJtaWRkbGUiPkdlbmVyYXRpb24gRmFpbGVkPC90ZXh0Pjwvc3ZnPg==';

const videoStyles = [
  "Cinematic Realism",
  "3D Pixar Style",
  "Anime",
  "Documentary",
  "Claymation",
  "Watercolor Painting",
  "Vintage Film",
  "Cyberpunk Neon",
  "Stop Motion",
  "Black and White Noir"
];

const videoLanguages = [
    "English", "Spanish", "French", "German", "Japanese", "Mandarin", "Hindi", "Russian"
];

const defaultVideoSettings: VideoSettings = {
  aspectRatio: '9:16',
  duration: 120,
  style: videoStyles[0],
  environment: '',
  characterConsistency: true,
  quality: 'standard',
  apiCallRate: 500,
  voiceId: '',
  language: videoLanguages[0],
};

const Section: React.FC<{ title: string; step?: number; children: React.ReactNode }> = ({ title, step, children }) => (
  <div className="bg-gray-800 rounded-lg shadow-lg mb-6"><h2 className="text-xl font-bold p-4 bg-gray-700/50 rounded-t-lg">{typeof step === 'number' && <span className="text-indigo-400 mr-2">{step}.</span>} {title}</h2><div className="p-6">{children}</div></div>
);

const ImageSequencePlayer: React.FC<{ images: string[] }> = ({ images }) => {
    const [currentIndex, setCurrentIndex] = useState(0);

    useEffect(() => {
        if (!images || images.length === 0) return;

        const timer = setTimeout(() => {
            setCurrentIndex(prevIndex => (prevIndex + 1) % images.length);
        }, 300); // ~3.3 FPS

        return () => clearTimeout(timer);
    }, [currentIndex, images]);

    if (!images || images.length === 0) {
        return <div className="w-full h-full flex items-center justify-center text-gray-500">No images</div>;
    }

    return (
        <img
            src={`data:image/png;base64,${images[currentIndex]}`}
            alt={`Frame ${currentIndex + 1}`}
            className="w-full h-full object-cover rounded-md"
        />
    );
};


const App: React.FC = () => {
  // State initialization
  const [mainIdea, setMainIdea] = useState<string>('');
  const [youtubeUrl, setYoutubeUrl] = useState<string>('');
  const [videoAnalysis, setVideoAnalysis] = useState<VideoAnalysis | null>(null);
  const [story, setStory] = useState<string>('');
  const [editedStorySummary, setEditedStorySummary] = useState<string>('');
  const [storyConcepts, setStoryConcepts] = useState<StoryConcept[]>([]);
  const [selectedStoryIndex, setSelectedStoryIndex] = useState<number | null>(null);
  const [numberOfStories, setNumberOfStories] = useState<number>(3);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [evolvingAssets, setEvolvingAssets] = useState<EvolvingAsset[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [finalMeta, setFinalMeta] = useState<FinalVideoMeta | null>(null);
  const [videoSettings, setVideoSettings] = useState<VideoSettings>(defaultVideoSettings);
  const [backgroundMusicStyle, setBackgroundMusicStyle] = useState<string>('none');
  const [uploadedMusic, setUploadedMusic] = useState<{ name: string; url: string } | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [uploadTargetId, setUploadTargetId] = useState<string | null>(null);
  const [testPrompt, setTestPrompt] = useState<string>('A majestic eagle soaring through a stormy sky.');
  const [testVideoUrl, setTestVideoUrl] = useState<string | null>(null);
  const [logs, setLogs] = useState(() => appLogger.getLogs());


  // Loading states
  const [isAnalyzingVideo, setIsAnalyzingVideo] = useState<boolean>(false);
  const [isGeneratingConcepts, setIsGeneratingConcepts] = useState<boolean>(false);
  const [isEnhancingStory, setIsEnhancingStory] = useState<boolean>(false);
  const [isAutoGeneratingCharacters, setIsAutoGeneratingCharacters] = useState<boolean>(false);
  const [isGeneratingEnvironment, setIsGeneratingEnvironment] = useState<boolean>(false);
  const [enhancingCharacterId, setEnhancingCharacterId] = useState<string | null>(null);
  const [isGeneratingScenes, setIsGeneratingScenes] = useState<boolean>(false);
  const [isGeneratingMeta, setIsGeneratingMeta] = useState<boolean>(false);
  const [isPreviewingSceneId, setIsPreviewingSceneId] = useState<string | null>(null);
  const [isRefiningAndGeneratingAll, setIsRefiningAndGeneratingAll] = useState<boolean>(false);
  const [isRegeneratingSelected, setIsRegeneratingSelected] = useState<boolean>(false);
  const [refiningSceneId, setRefiningSceneId] = useState<string | null>(null);
  const [isPreviewingAllScenes, setIsPreviewingAllScenes] = useState<boolean>(false);
  const [regeneratingPromptId, setRegeneratingPromptId] = useState<string | null>(null);
  const [isCombining, setIsCombining] = useState<boolean>(false);
  const [selectedSceneIds, setSelectedSceneIds] = useState<Set<string>>(new Set());
  const [mergeLogs, setMergeLogs] = useState<string>('');
  const [activeGenerations, setActiveGenerations] = useState<Set<string>>(new Set());
  const [isGeneratingTestVideo, setIsGeneratingTestVideo] = useState(false);
  const [testVideoOperation, setTestVideoOperation] = useState<any | null>(null);
  const [testVideoProgress, setTestVideoProgress] = useState<number>(0);
  const [testVideoError, setTestVideoError] = useState<string | null>(null);
  
  // API Key management
  const [isOpeningKeySelector, setIsOpeningKeySelector] = useState(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [apiKeySelected, setApiKeySelected] = useState<boolean>(false);
  const [geminiApiKey, setGeminiApiKey] = useState<string>(() => {
    try { return localStorage.getItem('GEMINI_API_KEY') || ''; } catch { return ''; }
  });
  const [isValidatingKey, setIsValidatingKey] = useState(false);
  const [elevenLabsApiKey, setElevenLabsApiKey] = useState<string>('');
  const [elevenLabsVoices, setElevenLabsVoices] = useState<ElevenLabsVoice[]>([]);
  const [veoSessionKey, setVeoSessionKey] = useState<string>(() => { try { return localStorage.getItem('VEO_FLOW_SESSION') || ''; } catch { return ''; } });
  const [veoApiBase, setVeoApiBase] = useState<string>(() => { try { return localStorage.getItem('VEO_FLOW_BASE') || ''; } catch { return ''; } });
  const [veoHeaderName, setVeoHeaderName] = useState<string>(() => { try { return localStorage.getItem('VEO_FLOW_HEADER') || 'Authorization'; } catch { return 'Authorization'; } });
  const [veoHeaderPrefix, setVeoHeaderPrefix] = useState<string>(() => { try { return localStorage.getItem('VEO_FLOW_PREFIX') || 'Bearer '; } catch { return 'Bearer '; } });
  const [veoCookieName, setVeoCookieName] = useState<string>(() => { try { return localStorage.getItem('VEO_FLOW_COOKIE') || ''; } catch { return ''; } });


  // Modal states
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState<boolean>(false);
  const [previewModalImage, setPreviewModalImage] = useState<string | null>(null);
  const [promptModalContent, setPromptModalContent] = useState<string>('');
  const [isPromptModalOpen, setIsPromptModalOpen] = useState(false);
  const [editingScene, setEditingScene] = useState<Scene | null>(null);


  const characterImageInputRef = useRef<HTMLInputElement>(null);
  const pollingIntervalRef = useRef<number | null>(null);

    // --- Logger Subscription ---
    useEffect(() => {
        appLogger.add('INFO', 'Application Initialized');
        const unsubscribe = appLogger.subscribe(setLogs);
        return () => unsubscribe();
    }, []);

  const handleConnectFlow = async () => {
    if (!(window as any).electronAPI || !openFlowAuth) {
      addNotification('Flow auth is only available in the Electron app.', 'error');
      return;
    }
    try {
      addNotification('Opening Flow login window. Please sign in to your VEO Ultra account.', 'info');
      const authUrl = 'https://labs.withgoogle.com/flow';
      // Try some common key names — user can adjust if detection fails
      const keyNames = ['veo_session', 'session', 'sessionKey', 'veo_token', 'authToken'];
      const res = await openFlowAuth({ authUrl, keyNames, timeoutMs: 120000 });
      if (res && res.success && res.session) {
        localStorage.setItem('VEO_FLOW_SESSION', res.session);
        setVeoSessionKey(res.session);
        // preserve other settings if detected
        if (res.key) {
          // nothing to save here by default
        }
        addNotification('Flow session captured successfully.', 'success');
        appLogger.add('INFO', 'Captured Flow session', { source: res.source, key: res.key });
      } else {
        console.warn('Flow auth result', res);
        addNotification(`Failed to capture session: ${res?.message || 'unknown'}`, 'error');
      }
    } catch (err) {
      console.error('Flow auth error', err);
      addNotification('Error during Flow authentication. See console for details.', 'error');
    }
  };

  const handleSaveVeoSettings = () => {
    try {
      localStorage.setItem('VEO_FLOW_BASE', veoApiBase || '');
      localStorage.setItem('VEO_FLOW_HEADER', veoHeaderName || 'Authorization');
      localStorage.setItem('VEO_FLOW_PREFIX', veoHeaderPrefix || 'Bearer ');
      localStorage.setItem('VEO_FLOW_COOKIE', veoCookieName || '');
      addNotification('VEO Flow settings saved.', 'success');
    } catch (e) {
      addNotification('Failed to save VEO Flow settings.', 'error');
    }
  };

  // --- NOTIFICATIONS ---
  const addNotification = useCallback((message: string, type: 'error' | 'success' | 'info') => {
    const id = Date.now();
    setNotifications(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 5000); // Auto-dismiss after 5 seconds
  }, []);
  
  const toggleSceneSelection = (sceneId: string) => {
    setSelectedSceneIds(prev => {
      const next = new Set(prev);
      if (next.has(sceneId)) next.delete(sceneId);
      else next.add(sceneId);
      return next;
    });
  };

  const handleMergeSelected = async () => {
    if (selectedSceneIds.size === 0) {
      addNotification('No scenes selected to merge.', 'info');
      return;
    }

    const selectedScenes = scenes.filter(s => selectedSceneIds.has(s.id) && s.videoUrl);
    if (selectedScenes.length === 0) {
      addNotification('Selected scenes must have generated videos.', 'error');
      return;
    }

    if ((window as any).electronAPI && (window as any).electronAPI.mergeBuffers) {
      try {
        const { canceled, filePath } = await showSaveDialog({ title: 'Save merged video', defaultPath: 'merged_video.mp4' });
        if (canceled || !filePath) return;

        // If all selected scenes already have local paths, use merge by file path (faster)
        const allHaveLocal = selectedScenes.every(s => (s as any).localPath);
        setIsCombining(true);
        addNotification('Merging selected scenes...', 'info');

        if (allHaveLocal) {
          try {
            const inputPaths = selectedScenes.map(s => (s as any).localPath as string);
            const unsubscribe = (window as any).electronAPI.onMergeLog((chunk: string) => {
              setMergeLogs(prev => prev + chunk);
            });
            const result = await (window as any).electronAPI.mergeVideos(inputPaths, filePath);
            unsubscribe && typeof unsubscribe === 'function' && unsubscribe();
            if (result && result.success) {
              addNotification('Merged video saved to disk.', 'success');
              appLogger.add('INFO', 'Merge successful', { output: result.output });
            } else {
              console.error('Merge failed', result);
              addNotification('Merge failed. See logs for details.', 'error');
              appLogger.add('ERROR', 'Merge failed', { result });
            }
          } catch (err) {
            console.error('Merge by path failed, falling back to buffer merge', err);
            // Fall back to buffer-based merging below
          }
        }

        // If not all scenes have localPath, or path-merge failed, fall back to sending buffers
        if (!allHaveLocal) {
          const unsubscribe = (window as any).electronAPI.onMergeLog((chunk: string) => {
            setMergeLogs(prev => prev + chunk);
          });

          const files: { name?: string; data: string }[] = [];
          for (let i = 0; i < selectedScenes.length; i++) {
            const s = selectedScenes[i];
            const url = s.videoUrl!;
            const buffer = await fetch(url).then(r => r.arrayBuffer());
            const bytes = new Uint8Array(buffer);
            let binary = '';
            const chunkSize = 0x8000;
            for (let j = 0; j < bytes.length; j += chunkSize) {
              binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(j, j + chunkSize)));
            }
            const base64 = btoa(binary);
            files.push({ name: `scene_${i + 1}.mp4`, data: base64 });
          }

          const result = await mergeBuffers(files, filePath);
          unsubscribe && typeof unsubscribe === 'function' && unsubscribe();

          if (result && result.success) {
            addNotification('Merged video saved to disk.', 'success');
            appLogger.add('INFO', 'Merge successful', { output: result.output });
          } else {
            console.error('Merge failed', result);
            addNotification('Merge failed. See logs for details.', 'error');
            appLogger.add('ERROR', 'Merge failed', { result });
          }
        }
      } catch (error) {
        handleApiError(error, 'merging selected scenes');
      } finally {
        setIsCombining(false);
      }
    } else {
      try {
        setIsCombining(true);
        addNotification('Combining selected scenes in browser...', 'info');
        const videoUrls = selectedScenes.map(s => s.videoUrl!);
        const combinedVideoUrl = await videoUtils.combineVideos(videoUrls);
        const a = document.createElement('a');
        a.href = combinedVideoUrl;
        a.download = 'merged_video.mp4';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(combinedVideoUrl), 100);
        addNotification('Combined video downloaded successfully!', 'success');
      } catch (error) {
        handleApiError(error, 'combining selected scenes');
      } finally {
        setIsCombining(false);
      }
    }
  };

  const dismissNotification = (id: number) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  // --- API KEY and ERROR HANDLING ---
  useEffect(() => {
    const checkApiKey = async () => {
      if (typeof window.aistudio?.hasSelectedApiKey !== 'function') {
        console.warn("aistudio SDK not found. Assuming no key selected.");
        setIsLoading(false);
        setApiKeySelected(false);
        return;
      }
      try {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setApiKeySelected(hasKey);
      } catch (e) {
        console.error("Error checking for API key:", e);
        setApiKeySelected(false);
      } finally {
        setIsLoading(false);
      }
    };

    // call the checker and close this effect
    checkApiKey();
  }, []);

    // --- API KEY and ERROR HANDLING ---
    useEffect(() => {
      const checkApiKey = () => {
        try {
          const stored = localStorage.getItem('GEMINI_API_KEY');
          setApiKeySelected(!!stored);
          setGeminiApiKey(stored || '');
        } catch (e) {
          setApiKeySelected(false);
          setGeminiApiKey('');
        } finally {
          setIsLoading(false);
        }
      };

      checkApiKey();
      const savedElevenLabsKey = localStorage.getItem(ELEVENLABS_API_KEY_STORAGE);
      if (savedElevenLabsKey) {
          setElevenLabsApiKey(savedElevenLabsKey);
      }
    }, []);

  const handleApiError = useCallback((error: unknown, context: string) => {
    const errorMessage = (error as Error).message || 'An unknown error occurred.';
    console.error(`Error during ${context}:`, error);
    appLogger.add('ERROR', `Error during ${context}`, { message: errorMessage, error: error });

    const haltAllGenerations = () => {
        setActiveGenerations(new Set());
        setScenes(prev => prev.map(s => ({ ...s, isGenerating: false, operation: undefined, generationProgress: 0, isGeneratingAudio: false })));
        setCharacters(prev => prev.map(c => ({...c, isGenerating: false})));
        setIsAnalyzingVideo(false); setIsGeneratingConcepts(false); setIsEnhancingStory(false); setIsGeneratingEnvironment(false);
        setEnhancingCharacterId(null); setIsGeneratingScenes(false); setIsGeneratingMeta(false); setIsPreviewingSceneId(null);
        setIsRefiningAndGeneratingAll(false); setIsRegeneratingSelected(false); setRefiningSceneId(null); setIsPreviewingAllScenes(false);
        setRegeneratingPromptId(null); setIsCombining(false);
        setIsGeneratingTestVideo(false);
        setIsAutoGeneratingCharacters(false);
        setTestVideoOperation(null);
    };
    
    if (errorMessage.includes("Requested entity was not found") || errorMessage.includes("API key not valid")) {
      addNotification("Your Google AI API Key is invalid. Please select a new one.", 'error');
      haltAllGenerations();
      setApiKeySelected(false);
    } else if (errorMessage.includes("RESOURCE_EXHAUSTED") || errorMessage.includes("quota")) {
      addNotification("You've exceeded your API quota. Please check billing or try again later.", 'error');
      haltAllGenerations();
    }
    else {
      addNotification(`Failed during ${context}: ${errorMessage}`, 'error');
      haltAllGenerations();
    }
  }, [addNotification]);


  // --- Handlers ---
  const handleSaveElevenLabsKey = () => {
    localStorage.setItem(ELEVENLABS_API_KEY_STORAGE, elevenLabsApiKey);
    appLogger.add('INFO', 'ElevenLabs API Key saved to local storage.');
    addNotification('ElevenLabs API Key saved.', 'success');
  };

  const handleGenerateSceneAudio = async (sceneId: string) => {
    const scene = scenes.find(s => s.id === sceneId);
    if (!scene) {
        addNotification("Scene not found.", 'error');
        return;
    }

    const textToSpeak = scene.prompt.dialogue?.join(' \n') || scene.summary;
    if (!textToSpeak.trim()) {
        addNotification("No text (dialogue or summary) found in the scene to generate audio.", 'info');
        return;
    }

    setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, isGeneratingAudio: true } : s));
    appLogger.add('INFO', 'Generating scene audio', { sceneId, voiceId: videoSettings.voiceId });

    try {
        const audioUrl = await elevenLabsService.generateVoiceOver(
            elevenLabsApiKey,
            textToSpeak,
            videoSettings.voiceId
        );
        setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, audioUrl } : s));
        addNotification(`Audio generated for Scene ${scenes.findIndex(s => s.id === sceneId) + 1}`, 'success');
        appLogger.add('INFO', 'Scene audio generation successful', { sceneId });
    } catch (error) {
        handleApiError(error, 'audio generation');
    } finally {
        setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, isGeneratingAudio: false } : s));
    }
  };

  const handleAnalyzeVideo = async () => {
    if (!youtubeUrl) {
      addNotification("Please enter a YouTube URL.", 'error');
      return;
    }
    setIsAnalyzingVideo(true);
    setVideoAnalysis(null);
    appLogger.add('INFO', 'Starting YouTube video analysis', { url: youtubeUrl });
    try {
      const result = await geminiService.analyzeYouTubeVideo(youtubeUrl);
      setVideoAnalysis(result);
      addNotification("Video analysis complete.", 'success');
      appLogger.add('INFO', 'YouTube video analysis successful');
    } catch (error) {
      handleApiError(error, 'video analysis');
    } finally {
      setIsAnalyzingVideo(false);
    }
  };

  const handleGenerateOrEditCharacterImage = useCallback(async (characterId: string) => {
    const character = characters.find(c => c.id === characterId);
    if (!character) {
      addNotification('Character not found.', 'error');
      return;
    }

    setCharacters(prev => prev.map(c => c.id === characterId ? { ...c, isGenerating: true } : c));
    // Quick client-side safety check to avoid calling the image API with prompts likely to be blocked
    const promptCheck = geminiService.isPromptAllowed(character.prompt || '');
    if (!promptCheck.allowed) {
      addNotification(`Prompt not allowed: ${promptCheck.reason}`, 'error');
      setCharacters(prev => prev.map(c => c.id === characterId ? { ...c, isGenerating: false } : c));
      return;
    }
    const operation = character.image ? 'editing' : 'generating';
    appLogger.add('INFO', `Starting character image ${operation}`, { name: character.name, prompt: character.prompt });
    try {
      let newImage: string;
      let newName: string | undefined = character.name;
      const newMimeType = 'image/png'; // Model output is consistently PNG

      if (character.image) {
        // Edit existing image
        const mimeTypeForEdit = character.imageMimeType || 'image/png';
        newImage = await geminiService.editCharacterImage(character.image, character.prompt, mimeTypeForEdit);
      } else {
        // Generate new image
        const result = await geminiService.generateCharacter(character.prompt, videoSettings.style, character.name);
        newImage = result.image;
        newName = result.name; // Name might be generated if it was empty
      }
      
      setCharacters(prev => prev.map(c => c.id === characterId ? { ...c, image: newImage, name: newName || c.name, imageMimeType: newMimeType, isGenerating: false } : c));
      addNotification(`Character image for ${newName} has been successfully ${character.image ? 'edited' : 'generated'}.`, 'success');
      appLogger.add('INFO', `Character image ${operation} successful`, { name: newName });
    } catch (error) {
      handleApiError(error, `image generation for ${character.name}`);
      setCharacters(prev => prev.map(c => c.id === characterId ? { ...c, isGenerating: false } : c));
    }
  }, [characters, videoSettings.style, addNotification, handleApiError]);
  
  const handleCharacterNameChange = (id: string, newName: string) => {
    setCharacters(prev => prev.map(c => c.id === id ? { ...c, name: newName } : c));
  };
  
  const handleCharacterPromptChange = (id: string, newPrompt: string) => {
    setCharacters(prev => prev.map(c => c.id === id ? { ...c, prompt: newPrompt } : c));
  };

  const handleDeleteCharacter = (id: string) => {
    const charName = characters.find(c => c.id === id)?.name || 'Unknown';
    setCharacters(prev => prev.filter(c => c.id !== id));
    appLogger.add('INFO', 'Character deleted', { name: charName });
  };

  const addCharacter = () => {
    const newId = `char_${Date.now()}`;
    setCharacters(prev => [...prev, {
      id: newId,
      name: '',
      prompt: '',
      image: '',
      isGenerating: false,
    }]);
    appLogger.add('INFO', 'New character added', { id: newId });
  };

  const handleUploadClick = (characterId: string) => {
    setUploadTargetId(characterId);
    characterImageInputRef.current?.click();
  };

  const handleImageFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0] && uploadTargetId) {
      const file = event.target.files[0];
      appLogger.add('INFO', 'Character image file selected for upload', { characterId: uploadTargetId, fileName: file.name, fileSize: file.size });
      try {
        const { base64: base64Image, mimeType } = await fileToBase64(file);
        setCharacters(prev =>
          prev.map(c =>
            c.id === uploadTargetId ? { ...c, image: base64Image, imageMimeType: mimeType } : c
          )
        );
        addNotification('Character image uploaded.', 'success');
        appLogger.add('INFO', 'Character image uploaded and converted to base64 successfully');
      } catch (error) {
        console.error("Error converting file to base64", error);
        addNotification('Failed to upload image.', 'error');
      } finally {
        setUploadTargetId(null);
        if (characterImageInputRef.current) {
          characterImageInputRef.current.value = '';
        }
      }
    }
  };

  const handleCreateCharactersFromAnalysis = async (analyzedCharacters: AnalyzedCharacter[]) => {
    addNotification(`Enhancing prompts for ${analyzedCharacters.length} character(s)... This may take a moment.`, 'info');
    appLogger.add('INFO', 'Creating characters from YouTube analysis', { count: analyzedCharacters.length });
    try {
      const newCharactersPromises = analyzedCharacters.map(async (c) => {
        const enhancedPrompt = await geminiService.enhanceCharacterPrompt(c.description);
        return {
          id: `char_${Date.now()}_${Math.random()}`,
          name: c.name,
          prompt: enhancedPrompt,
          image: '',
          isGenerating: false,
        };
      });

      const newCharacters = await Promise.all(newCharactersPromises);
      
      setCharacters(prev => [...prev, ...newCharacters]);
      addNotification(`${newCharacters.length} character(s) added from analysis with enhanced prompts.`, 'success');
      appLogger.add('INFO', 'Successfully created characters from analysis');
    } catch (error) {
      handleApiError(error, 'creating characters from analysis');
    }
  };

  const handleCloneVideoFromAnalysis = async () => {
    if (!videoAnalysis) return;

    const fullStory = videoAnalysis.segments
        .map(segment => segment.storyAction)
        .join(' \n\n');
    
    setMainIdea(fullStory);
    setStory(fullStory);
    setEditedStorySummary(fullStory);

    const allCharacters: AnalyzedCharacter[] = [];
    const characterNames = new Set<string>();
    videoAnalysis.segments.forEach(segment => {
        segment.analyzedCharacters.forEach(char => {
            if (!characterNames.has(char.name)) {
                allCharacters.push(char);
                characterNames.add(char.name);
            }
        });
    });

    if (allCharacters.length > 0) {
        await handleCreateCharactersFromAnalysis(allCharacters);
    }
    
    addNotification("Cloned story and characters from YouTube analysis!", 'success');
    appLogger.add('INFO', 'Cloned story and characters from YouTube analysis');
  };

  const handleEnhanceStory = async () => {
    const storyToEnhance = mainIdea || editedStorySummary || story;
    if (!storyToEnhance) {
        addNotification("There is no story to enhance.", 'error');
        return;
    }
    setIsEnhancingStory(true);
    appLogger.add('INFO', 'Enhancing story for virality', { storyLength: storyToEnhance.length });
    try {
        const enhancedStory = await geminiService.enhanceStory(storyToEnhance, characters);
        setEditedStorySummary(enhancedStory);
        addNotification("Story has been enhanced for better engagement!", 'success');
        appLogger.add('INFO', 'Story enhancement successful');
    } catch (error) {
        handleApiError(error, 'enhancing story');
    } finally {
        setIsEnhancingStory(false);
    }
  };
  
  const handleAutoGenerateCharacters = async () => {
    const storyToUse = editedStorySummary || story || mainIdea;
    if (!storyToUse) {
      addNotification("Please provide a story in Step 2 first.", 'error');
      return;
    }

    setIsAutoGeneratingCharacters(true);
    addNotification("Auto-generating characters based on your story... This may take a moment.", 'info');
    appLogger.add('INFO', 'Starting auto character generation');

    try {
      const newCharacterData = await geminiService.generateCharactersFromStory(storyToUse, videoSettings.style);

      if (newCharacterData.length === 0) {
        addNotification("The AI couldn't identify distinct characters to generate from the story.", 'info');
      } else {
        const newCharacters: Character[] = newCharacterData.map(data => ({
          id: `char_${Date.now()}_${Math.random()}`,
          name: data.name,
          prompt: data.prompt,
          image: data.image,
          imageMimeType: data.imageMimeType,
          isGenerating: false,
        }));

        setCharacters(prev => [...prev, ...newCharacters]);
        addNotification(`Successfully generated ${newCharacters.length} new character(s)!`, 'success');
        appLogger.add('INFO', 'Auto character generation successful', { count: newCharacters.length });
      }
    } catch (error) {
      handleApiError(error, 'auto-generating characters');
    } finally {
      setIsAutoGeneratingCharacters(false);
    }
  };

  const handleGenerateScenes = async () => {
    const storyToUse = editedStorySummary || story || mainIdea;
    if (!storyToUse) {
      addNotification("Please provide a story first.", 'error');
      return;
    }
    if (characters.length === 0) {
      addNotification("Please create at least one character.", 'error');
      return;
    }
    if (!characters.every(c => c.image)) {
        addNotification("Please generate images for all characters first.", 'error');
        return;
    }

    setIsGeneratingScenes(true);
    setScenes([]); // Clear old scenes
    appLogger.add('INFO', 'Starting scene generation', { storyLength: storyToUse.length, characters: characters.length });
    try {
      addNotification("Generating scene prompts... this may take some time for longer videos.", 'info');
      const sceneData = await geminiService.generateScenes(
        storyToUse,
        characters,
        evolvingAssets,
        videoSettings
      );
      
      const newScenes: Scene[] = sceneData.map((data, index) => ({
        id: `scene_${Date.now()}_${index}`,
        summary: data.summary,
        prompt: data.prompt,
        isGenerating: false,
        isSelected: false,
      }));

      setScenes(newScenes);
      addNotification(`Successfully generated ${newScenes.length} scene prompts.`, 'success');
      appLogger.add('INFO', `Scene generation successful`, { sceneCount: newScenes.length });

    } catch (error) {
      handleApiError(error, 'scene generation');
    } finally {
      setIsGeneratingScenes(false);
    }
  };
  
  const handleGenerateScenePreview = async (sceneId: string) => {
      const scene = scenes.find(s => s.id === sceneId);
      if (!scene) {
          addNotification("Scene not found.", 'error');
          return;
      }
  
      setIsPreviewingSceneId(sceneId);
      appLogger.add('INFO', 'Generating scene preview', { sceneId });
      try {
          const previewImage = await geminiService.generateScenePreview(scene.prompt, characters);
          setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, previewImage } : s));
          addNotification(`Preview generated for Scene ${scenes.findIndex(s => s.id === sceneId) + 1}`, 'success');
          appLogger.add('INFO', 'Scene preview generation successful', { sceneId });
      } catch (error) {
          handleApiError(error, 'scene preview generation');
          setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, previewImage: 'failed' } : s));
      } finally {
          setIsPreviewingSceneId(null);
      }
  };

  const handleSceneSummaryChange = (sceneId: string, newSummary: string) => {
      setScenes(prevScenes =>
          prevScenes.map(scene =>
              scene.id === sceneId ? { ...scene, summary: newSummary } : scene
          )
      );
  };
  
  const openPromptEditor = (scene: Scene) => {
      setEditingScene(scene);
      setPromptModalContent(JSON.stringify(scene.prompt, null, 2));
      setIsPromptModalOpen(true);
  };
  
  const closePromptEditor = () => {
      setIsPromptModalOpen(false);
      setEditingScene(null);
      setPromptModalContent('');
  };

  const handleSavePromptChanges = () => {
      if (!editingScene) return;
      appLogger.add('INFO', 'Saving manual prompt changes', { sceneId: editingScene.id });
      try {
          const newPrompt = JSON.parse(promptModalContent);
          // Basic validation
          if (typeof newPrompt !== 'object' || newPrompt === null || !newPrompt.scene_id) {
              throw new Error("Invalid prompt structure.");
          }
          setScenes(prev => 
              prev.map(s => s.id === editingScene.id ? { ...s, prompt: newPrompt } : s)
          );
          addNotification('Prompt updated successfully.', 'success');
          appLogger.add('INFO', 'Manual prompt changes saved successfully', { sceneId: editingScene.id });
          closePromptEditor();
      } catch (error) {
          console.error("Error parsing JSON:", error);
          addNotification(`Invalid JSON format. Please check your syntax. ${(error as Error).message}`, 'error');
          appLogger.add('ERROR', 'Invalid JSON in prompt editor', { error, sceneId: editingScene.id });
      }
  };

    const handleGenerateSceneVideo = async (sceneId: string) => {
        const sceneToGenerate = scenes.find(s => s.id === sceneId);
        if (!sceneToGenerate) {
            addNotification("Scene not found", 'error');
            return;
        }
        
        appLogger.add('INFO', `Starting video generation for scene`, { sceneId });
        setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, isGenerating: true, generationProgress: 0, videoUrl: undefined, imageSequence: undefined } : s));
        setActiveGenerations(prev => new Set(prev).add(sceneId));

        try {
            const operation = await geminiService.startVideoGeneration(sceneToGenerate.prompt, videoSettings.aspectRatio, videoSettings.quality, characters);
            if (operation && operation.__flow) {
              // Flow returned a ready video URL; set it immediately
              const uri = operation.response?.generatedVideos?.[0]?.video?.uri;
              if (uri) {
                setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, videoUrl: uri, isGenerating: false, operation: undefined } : s));
                addNotification(`Video for scene ${scenes.findIndex(s => s.id === sceneId) + 1} is ready (via Flow)!`, 'success');
                appLogger.add('INFO', 'Scene video generation (Flow) complete', { sceneId });
                setActiveGenerations(prev => {
                  const newSet = new Set(prev);
                  newSet.delete(sceneId);
                  return newSet;
                });
              } else {
                setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, isGenerating: false } : s));
              }
            } else {
              setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, operation } : s));
            }
        } catch (error) {
            handleApiError(error, 'starting video generation');
            setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, isGenerating: false } : s));
            setActiveGenerations(prev => {
                const newSet = new Set(prev);
                newSet.delete(sceneId);
                return newSet;
            });
        }
    };

    const handleGenerateSceneOutput = async (sceneId: string) => {
      const scene = scenes.find(s => s.id === sceneId);
      if (!scene) {
        addNotification('Scene not found.', 'error');
        return;
      }
    
      if (videoSettings.quality === 'free') {
        // Generate image sequence
        appLogger.add('INFO', 'Starting image sequence generation', { sceneId });
        setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, isGenerating: true, generationProgress: 0, videoUrl: undefined, imageSequence: undefined } : s));
        try {
          const images = await geminiService.generateImageSequenceForScene(scene.prompt, scene.summary, characters);
          setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, imageSequence: images, isGenerating: false } : s));
          addNotification(`Image sequence generated for Scene ${scenes.findIndex(s => s.id === sceneId) + 1}`, 'success');
          appLogger.add('INFO', 'Image sequence generation successful', { sceneId });
        } catch (error) {
          handleApiError(error, 'image sequence generation');
          setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, isGenerating: false } : s));
        }
      } else {
        // Generate video using the existing function
        handleGenerateSceneVideo(sceneId);
      }
    };

    const pollVideoStatus = useCallback(async () => {
        if (activeGenerations.size === 0) {
            if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
                pollingIntervalRef.current = null;
            }
            return;
        }

        for (const sceneId of activeGenerations) {
            const scene = scenes.find(s => s.id === sceneId);
            if (!scene || !scene.operation) continue;

            try {
                const updatedOperation = await geminiService.checkVideoOperationStatus(scene.operation);
                
                const progress = updatedOperation.metadata?.progress?.percentage || scene.generationProgress || 0;
                setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, operation: updatedOperation, generationProgress: progress } : s));

                if (updatedOperation.done) {
                        if (updatedOperation.response) {
                        const uri = updatedOperation.response.generatedVideos[0].video.uri;
                        const videoUrl = await geminiService.fetchVideoData(uri);

                        // If running inside Electron, prompt user to save the generated video to disk
                        if ((window as any).electronAPI && (window as any).electronAPI.saveBase64File && (window as any).electronAPI.showSaveDialog) {
                          try {
                            const sceneIndex = scenes.findIndex(s => s.id === sceneId);
                            const defaultName = `scene_${String(sceneIndex + 1).padStart(2, '0')}.mp4`;
                            const { canceled, filePath } = await showSaveDialog({ title: 'Save generated scene video', defaultPath: defaultName });
                            if (!canceled && filePath) {
                              // fetch blob and convert to base64
                              const buffer = await fetch(videoUrl).then(r => r.arrayBuffer());
                              const bytes = new Uint8Array(buffer);
                              let binary = '';
                              const chunkSize = 0x8000;
                              for (let j = 0; j < bytes.length; j += chunkSize) {
                                binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(j, j + chunkSize)));
                              }
                              const base64 = btoa(binary);
                              const res = await saveBase64File(base64, filePath);
                              if (res && res.success) {
                                // Use file:// URL for playback and store localPath
                                const fileUrl = `file://${res.filePath}`;
                                setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, videoUrl: fileUrl, localPath: res.filePath, isGenerating: false, operation: undefined } : s));
                              } else {
                                // Failed to save; fallback to blob URL
                                setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, videoUrl, isGenerating: false, operation: undefined } : s));
                              }
                            } else {
                              // User cancelled save; keep blob URL
                              setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, videoUrl, isGenerating: false, operation: undefined } : s));
                            }
                          } catch (err) {
                            console.error('Error saving generated video:', err);
                            setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, videoUrl, isGenerating: false, operation: undefined } : s));
                          }
                        } else {
                          // Not running in Electron; use blob URL for browser playback
                          setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, videoUrl, isGenerating: false, operation: undefined } : s));
                        }

                        addNotification(`Video for scene ${scenes.findIndex(s => s.id === sceneId) + 1} is ready!`, 'success');
                        appLogger.add('INFO', 'Scene video generation complete', { sceneId });
                    } else if (updatedOperation.error) {
                       throw new Error(updatedOperation.error.message || 'Unknown generation error.');
                    }
                    
                    setActiveGenerations(prev => {
                        const newSet = new Set(prev);
                        newSet.delete(sceneId);
                        return newSet;
                    });
                }
            } catch (error) {
                handleApiError(error, `polling video status for scene ${scenes.findIndex(s => s.id === sceneId) + 1}`);
                setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, isGenerating: false, operation: undefined } : s));
                setActiveGenerations(prev => {
                    const newSet = new Set(prev);
                    newSet.delete(sceneId);
                    return newSet;
                });
            }
        }
    }, [scenes, activeGenerations, addNotification, handleApiError]);

    const handleGenerateTestVideo = async () => {
        if (!testPrompt) {
            addNotification("Please enter a test prompt.", 'error');
            return;
        }
        setIsGeneratingTestVideo(true);
        setTestVideoUrl(null);
        setTestVideoProgress(0);
        setTestVideoOperation(null);
        setTestVideoError(null);
        appLogger.add('INFO', 'Starting test video generation', { prompt: testPrompt });

        const testScenePrompt: ScenePrompt = {
            scene_id: 'test_scene',
            timestamp_start: '0:00',
            timestamp_end: '0:08',
            duration_sec: 8,
            visual_style: videoSettings.style,
            character_lock: {},
            background_lock: {},
            camera: { shot_type: '', angle: '', movement: '' },
            foley_and_ambience: { sound_effects: [], ambient_sounds: '' },
            fx: { visual_effects: '', transitions: '' },
            dialogue: [],
            complete_prompt: testPrompt,
        };

        try {
            const operation = await geminiService.startVideoGeneration(testScenePrompt, videoSettings.aspectRatio, videoSettings.quality, []);
            setTestVideoOperation(operation);
        } catch (error) {
            const errorMessage = (error as Error).message || 'Failed to start test video generation.';
            setTestVideoError(errorMessage);
            handleApiError(error, 'starting test video generation');
            setIsGeneratingTestVideo(false);
        }
    };

    // Robust polling for the test video generation
    useEffect(() => {
        if (!testVideoOperation) {
            return;
        }

        let isCancelled = false;
        let pollingTimeoutId: number | undefined;

        const masterTimeoutId = setTimeout(() => {
            if (!isCancelled) {
                isCancelled = true;
                setIsGeneratingTestVideo(false);
                setTestVideoOperation(null);
                const errorMessage = "Video generation timed out after 5 minutes. This might be due to API permissions on the selected Google Account or high server load.";
                setTestVideoError(errorMessage);
                handleApiError(new Error(errorMessage), 'test video timeout');
            }
        }, 5 * 60 * 1000); // 5 minutes

        const poll = async (operationToPoll: any) => {
            if (isCancelled) return;

            try {
                const updatedOperation = await geminiService.checkVideoOperationStatus(operationToPoll);
                if (isCancelled) return;

                const progress = updatedOperation.metadata?.progress?.percentage || 0;
                setTestVideoProgress(progress);

                if (updatedOperation.done) {
                    clearTimeout(masterTimeoutId);
                    setIsGeneratingTestVideo(false);
                    setTestVideoOperation(null);

                    if (updatedOperation.response) {
                        const uri = updatedOperation.response.generatedVideos[0].video.uri;
                        const videoUrl = await geminiService.fetchVideoData(uri);
                        setTestVideoUrl(videoUrl);
                        addNotification(`Test video is ready!`, 'success');
                        appLogger.add('INFO', 'Test video generation complete');
                    } else {
                        const errorMessage = updatedOperation.error?.message || 'Generation finished with an unknown error.';
                        setTestVideoError(errorMessage);
                        handleApiError(new Error(errorMessage), 'generating test video');
                    }
                } else {
                    pollingTimeoutId = window.setTimeout(() => poll(updatedOperation), 5000);
                }
            } catch (error) {
                if (isCancelled) return;
                clearTimeout(masterTimeoutId);
                const errorMessage = (error as Error).message || 'Failed to poll test video status.';
                setTestVideoError(errorMessage);
                handleApiError(error, 'polling test video status');
                setIsGeneratingTestVideo(false);
                setTestVideoOperation(null);
            }
        };

        poll(testVideoOperation);

        return () => {
            isCancelled = true;
            clearTimeout(masterTimeoutId);
            if (pollingTimeoutId) {
                clearTimeout(pollingTimeoutId);
            }
        };
    }, [testVideoOperation, addNotification, handleApiError]);

    useEffect(() => {
        if (activeGenerations.size > 0 && !pollingIntervalRef.current) {
            pollingIntervalRef.current = window.setInterval(pollVideoStatus, 5000); // Poll every 5 seconds
        } else if (activeGenerations.size === 0 && pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
        }

        return () => {
            if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
            }
        };
    }, [activeGenerations, pollVideoStatus]);


    const handleDownloadAllPrompts = () => {
        if (scenes.length === 0) {
            addNotification("No scenes available to download.", 'info');
            return;
        }

        appLogger.add('INFO', 'Downloading all prompts');
        const content = scenes.map((scene, index) => {
            return `
============================================================
== SCENE ${index + 1} (${scene.prompt.timestamp_start} - ${scene.prompt.timestamp_end})
============================================================

${scene.prompt.complete_prompt}
            `.trim();
        }).join('\n\n\n');

        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'all_scene_prompts.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        addNotification("All prompts downloaded.", 'success');
    };

    const areAllVideosGenerated = scenes.length > 0 && scenes.every(s => s.videoUrl);

    const handleCombineAndDownload = async () => {
        if (!areAllVideosGenerated) {
            addNotification('Please generate the video for all scenes first.', 'error');
            return;
        }
    
        setIsCombining(true);
        addNotification('Combining all video scenes... This may take a moment.', 'info');
        appLogger.add('INFO', 'Starting video combination process');
    
        try {
            const videoUrls = scenes.map(s => s.videoUrl!);
            const combinedVideoUrl = await videoUtils.combineVideos(videoUrls);
    
            const a = document.createElement('a');
            a.href = combinedVideoUrl;
            a.download = 'final_video.mp4';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            
            setTimeout(() => URL.revokeObjectURL(combinedVideoUrl), 100);
    
            addNotification('Combined video downloaded successfully!', 'success');
            appLogger.add('INFO', 'Video combination and download successful');
    
        } catch (error) {
            handleApiError(error, 'combining videos');
        } finally {
            setIsCombining(false);
        }
    };

    if (isLoading) {
      return <div className="min-h-screen w-full flex items-center justify-center bg-gray-900"><Loader text="Initializing Application..." /></div>;
    }
  
    
    
    // FIX: Explicitly type `videoModelOptions` to allow for an optional `tooltip` property, resolving a TypeScript error.
    const videoModelOptions: {
        id: VideoQuality;
        icon: React.FC<{ className?: string }>;
        name: string;
        description: string;
        tooltip?: string;
    }[] = [
        { id: 'free', icon: PhotographIcon, name: 'Free (Image Sequence)', description: 'Generates a quick image slideshow. No video credits used.' },
        { id: 'standard', icon: LightningBoltIcon, name: 'Standard (Veo Fast)', description: 'Fast 720p video generation. Good for drafts.' },
        { id: 'high', icon: DiamondIcon, name: 'High (Veo Ultra)', description: 'Best quality 1080p video. Slower generation.', tooltip: 'This model may require special permissions. If generation fails, ensure your selected Google AI API Key is associated with an account that has access to Veo Ultra models.' },
        { id: 'flow', icon: PaintBrushIcon, name: 'Flow (Veo Artistic)', description: 'Cinematic, fluid style. 720p.', tooltip: 'This model may require special permissions. If generation fails, ensure your selected Google AI API Key is associated with an account that has access to Veo Ultra models.' },
    ];

  
  return (
    <div className="container mx-auto p-4 md:p-8 font-sans">
      <NotificationContainer notifications={notifications} onDismiss={dismissNotification} />
      <LogPanel logs={logs} onClear={() => appLogger.clear()} />
      
      <input
        type="file"
        ref={characterImageInputRef}
        onChange={handleImageFileChange}
        accept="image/png, image/jpeg"
        style={{ display: 'none' }}
        aria-hidden="true"
      />

      <div className="mb-6 p-4 bg-gray-800 rounded-lg flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        {!apiKeySelected ? (
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 w-full">
            <input
              value={geminiApiKey}
              onChange={e => setGeminiApiKey(e.target.value)}
              placeholder="Enter Gemini API Key"
              className="flex-1 bg-gray-900 border border-gray-700 p-2 rounded text-white"
            />
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  if (!geminiApiKey || geminiApiKey.trim().length === 0) return;
                  setIsValidatingKey(true);
                  try {
                    const res = await validateApiKey(geminiApiKey.trim());
                    if (res.valid) {
                      localStorage.setItem('GEMINI_API_KEY', geminiApiKey.trim());
                      setApiKeySelected(true);
                      addNotification('Gemini API key saved and validated.', 'success');
                    } else {
                      console.error('API key validation failed:', res.message);
                      addNotification(`API key validation failed: ${res.message || 'Invalid key'}`, 'error');
                    }
                  } catch (e) {
                    console.error('Validation error', e);
                    addNotification('API key validation error. See console for details.', 'error');
                  } finally {
                    setIsValidatingKey(false);
                  }
                }}
                disabled={!geminiApiKey || isValidatingKey}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-900 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-md"
              >
                {isValidatingKey ? 'Validating...' : 'Save Key'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between w-full">
            <div className="text-sm text-green-400">Gemini API Key saved.</div>
            <div className="flex gap-2">
              <button
                onClick={() => { localStorage.removeItem('GEMINI_API_KEY'); setApiKeySelected(false); setGeminiApiKey(''); addNotification('Gemini API key removed.', 'info'); }}
                className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-md"
              >
                Remove Key
              </button>
            </div>
          </div>
        )}
      </div>

      {isPromptModalOpen && editingScene && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={closePromptEditor}>
          <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-3xl h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-4 border-b border-gray-700">
              <h3 className="text-xl font-bold">Editing Prompt for Scene {scenes.findIndex(s => s.id === editingScene.id) + 1}</h3>
              <button onClick={closePromptEditor} className="text-gray-400 hover:text-white text-2xl font-bold">&times;</button>
            </div>
            <div className="p-4 flex-grow overflow-y-auto">
              <textarea
                value={promptModalContent}
                onChange={(e) => setPromptModalContent(e.target.value)}
                className="w-full h-full p-3 bg-gray-900 text-gray-200 font-mono text-sm border border-gray-600 rounded-md resize-none"
                spellCheck="false"
              />
            </div>
            <div className="p-4 border-t border-gray-700 flex justify-end gap-2">
              <button onClick={closePromptEditor} className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-md">Cancel</button>
              <button onClick={handleSavePromptChanges} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-md">Save Changes</button>
            </div>
          </div>
        </div>
       )}

      <header className="text-center mb-10">
        <h1 className="text-4xl md:text-5xl font-bold text-white mb-2">
          <span className="text-indigo-400">AI</span> Video Short Generator
        </h1>
        <p className="text-gray-400">
          Craft compelling short videos from your ideas with the power of AI.
        </p>
      </header>

      <main>
        <Section title="API Configuration">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <label htmlFor="eleven-labs-key" className="block text-sm font-medium text-gray-300 mb-2">ElevenLabs API Key (for Voiceovers)</label>
                    <div className="flex gap-2">
                    <input
                        id="eleven-labs-key"
                        type="password"
                        value={elevenLabsApiKey}
                        onChange={(e) => setElevenLabsApiKey(e.target.value)}
                        placeholder="Enter your ElevenLabs API key"
                        className="flex-grow p-2 bg-gray-700 border border-gray-600 rounded-md"
                    />
                    <button onClick={handleSaveElevenLabsKey} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-md flex items-center gap-2">
                        <SaveIcon className="w-5 h-5" />
                        Save
                    </button>
                    </div>
                     {elevenLabsApiKey && elevenLabsVoices.length > 0 && <p className="text-sm text-green-400 mt-2">API Key is valid. {elevenLabsVoices.length} voices loaded.</p>}
                </div>
                <div>
                    <label htmlFor="voice-select" className="block text-sm font-medium text-gray-300 mb-2">Narration Voice</label>
                    <select
                    id="voice-select"
                    value={videoSettings.voiceId}
                    onChange={(e) => setVideoSettings(prev => ({ ...prev, voiceId: e.target.value }))}
                    disabled={!elevenLabsApiKey || elevenLabsVoices.length === 0}
                    className="w-full p-2.5 bg-gray-700 border border-gray-600 rounded-md disabled:opacity-50"
                    >
                    {elevenLabsVoices.length > 0 ? (
                        elevenLabsVoices.map(voice => (
                        <option key={voice.id} value={voice.id}>{voice.name}</option>
                        ))
                    ) : (
                        <option>
                        {elevenLabsApiKey ? 'Loading voices...' : 'Enter API key to load voices'}
                        </option>
                    )}
                    </select>
                </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">VEO Ultra (Flow) Integration</label>
                    <div className="flex gap-2 items-center">
                      <button onClick={handleConnectFlow} className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-md">Connect Flow</button>
                      <div className="text-sm text-gray-300">
                        {veoSessionKey ? <span>Session: <code className="text-xs">{veoSessionKey.slice(0,8)}...{veoSessionKey.slice(-6)}</code></span> : <span className="text-gray-500">Not connected</span>}
                      </div>
                    </div>
                    <p className="text-xs text-gray-400 mt-2">Open the Flow login and sign in; the app will attempt to capture your session token for VEO Ultra. The token is stored locally.</p>
                    <div className="mt-3 grid grid-cols-1 gap-2">
                      <input value={veoSessionKey} onChange={(e)=>setVeoSessionKey(e.target.value)} placeholder="Paste session token here" className="p-2 bg-gray-700 border border-gray-600 rounded-md text-sm" />
                      <div className="flex gap-2">
                        <input value={veoApiBase} onChange={(e)=>setVeoApiBase(e.target.value)} placeholder="Flow API base (optional)" className="flex-1 p-2 bg-gray-700 border border-gray-600 rounded-md text-sm" />
                        <button onClick={handleSaveVeoSettings} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-3 rounded-md">Save</button>
                      </div>
                      <div className="flex gap-2">
                        <input value={veoHeaderName} onChange={(e)=>setVeoHeaderName(e.target.value)} placeholder="Auth header name (Authorization)" className="flex-1 p-2 bg-gray-700 border border-gray-600 rounded-md text-sm" />
                        <input value={veoHeaderPrefix} onChange={(e)=>setVeoHeaderPrefix(e.target.value)} placeholder="Header prefix (Bearer )" className="w-40 p-2 bg-gray-700 border border-gray-600 rounded-md text-sm" />
                      </div>
                      <input value={veoCookieName} onChange={(e)=>setVeoCookieName(e.target.value)} placeholder="Cookie name (optional)" className="p-2 bg-gray-700 border border-gray-600 rounded-md text-sm" />
                    </div>
                  </div>
            </div>
            <div className="mt-6 pt-6 border-t border-gray-700 space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Google AI Project & API Key Management</label>
                    <div className="flex items-center gap-4 p-4 bg-gray-900/50 rounded-md border border-gray-700">
                        <div className="flex-shrink-0">
                            <KeyIcon className="w-8 h-8 text-indigo-400" />
                        </div>
                        <div className="flex-grow">
                            <p className="font-semibold text-white">Google AI API Key Status</p>
                            <div className="flex items-center gap-2 text-sm text-green-400">
                                <CheckCircleIcon className="w-5 h-5" />
                                <span>Key Active</span>
                            </div>
                        </div>
                        <button
                            onClick={async () => {
                                setIsOpeningKeySelector(true);
                                try {
                                    await window.aistudio.openSelectKey();
                                    addNotification('Google AI API Key selection prompt opened. The new key will be used for subsequent requests.', 'info');
                                } catch (e) {
                                    console.error("Could not open API key selection:", e);
                                    addNotification("Could not open the API key selection dialog.", 'error');
                                } finally {
                                setIsOpeningKeySelector(false);
                                }
                            }}
                            disabled={isOpeningKeySelector}
                            className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-800 disabled:cursor-wait text-white font-bold py-2 px-4 rounded-md transition duration-200 flex items-center justify-center min-w-[140px]"
                        >
                            {isOpeningKeySelector ? (
                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                            ) : (
                                <>
                                    <RefreshIcon className="w-5 h-5 mr-2" />
                                    Change Key
                                </>
                            )}
                        </button>
                    </div>
                </div>
                <div className="p-4 bg-gray-900/50 rounded-md flex items-start gap-4 border border-blue-900/50">
                    <div className="flex-shrink-0 pt-1">
                        <InformationCircleIcon className="w-6 h-6 text-blue-400" />
                    </div>
                    <div>
                        <h4 className="font-semibold text-white">How to Switch Google Accounts</h4>
                        <p className="text-sm text-gray-400 mt-1">
                            To use an API key from a different Google Account (e.g., one with access to Veo Ultra), you must **log out of AI Studio and log back in** with the desired account. This application securely uses the key associated with your current session. Importing JSON key files is not supported for security reasons.
                        </p>
                    </div>
                </div>
            </div>
        </Section>

        <Section title="Video Settings" step={1}>
             <div>
                <label className="block text-sm font-medium text-gray-300 mb-3">Video Generation Model</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {videoModelOptions.map(option => (
                        <div
                            key={option.id}
                            onClick={() => setVideoSettings(prev => ({ ...prev, quality: option.id as VideoQuality }))}
                            className={`relative group p-4 rounded-lg border-2 cursor-pointer transition-all duration-200 ${
                                videoSettings.quality === option.id ? 'bg-indigo-900/50 border-indigo-500' : 'bg-gray-700/50 border-gray-600 hover:border-indigo-700'
                            }`}
                        >
                            <div className="flex items-start justify-between gap-3 mb-2">
                                <div className="flex items-center gap-3">
                                    <option.icon className={`w-6 h-6 ${videoSettings.quality === option.id ? 'text-indigo-400' : 'text-gray-400'}`} />
                                    <h4 className="font-bold text-white">{option.name}</h4>
                                </div>
                                {option.tooltip && (
                                    <div className="relative">
                                        <QuestionMarkCircleIcon className="w-5 h-5 text-gray-500 group-hover:text-gray-300" />
                                    </div>
                                )}
                            </div>
                            <p className="text-xs text-gray-400">{option.description}</p>
                            {option.tooltip && (
                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2 text-xs text-center text-white bg-gray-900 border border-gray-600 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-10">
                                    {option.tooltip}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mt-6 pt-6 border-t border-gray-700">
                <div>
                    <label htmlFor="video-style" className="block text-sm font-medium text-gray-300 mb-2">Visual Style</label>
                    <select
                        id="video-style"
                        value={videoSettings.style}
                        onChange={(e) => setVideoSettings(prev => ({ ...prev, style: e.target.value }))}
                        className="w-full p-2.5 bg-gray-700 border border-gray-600 rounded-md"
                    >
                        {videoStyles.map(style => <option key={style} value={style}>{style}</option>)}
                    </select>
                </div>
                <div>
                    <label htmlFor="video-length" className="block text-sm font-medium text-gray-300 mb-2">Video Length (seconds)</label>
                    <input
                        type="number"
                        id="video-length"
                        value={videoSettings.duration}
                        onChange={(e) => setVideoSettings(prev => ({ ...prev, duration: parseInt(e.target.value, 10) || 0 }))}
                        className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md"
                        min="1"
                    />
                </div>
                <div>
                    <label htmlFor="video-size" className="block text-sm font-medium text-gray-300 mb-2">Video Size (Aspect Ratio)</label>
                    <select
                        id="video-size"
                        value={videoSettings.aspectRatio}
                        onChange={(e) => setVideoSettings(prev => ({ ...prev, aspectRatio: e.target.value as AspectRatio }))}
                        className="w-full p-2.5 bg-gray-700 border border-gray-600 rounded-md"
                    >
                        <option value="9:16">9:16 (Portrait/Shorts)</option>
                        <option value="16:9">16:9 (Landscape/Widescreen)</option>
                    </select>
                </div>
                <div>
                    <label htmlFor="video-language" className="block text-sm font-medium text-gray-300 mb-2">Dialogue Language</label>
                    <select
                        id="video-language"
                        value={videoSettings.language}
                        onChange={(e) => setVideoSettings(prev => ({ ...prev, language: e.target.value }))}
                        className="w-full p-2.5 bg-gray-700 border border-gray-600 rounded-md"
                    >
                        {videoLanguages.map(lang => <option key={lang} value={lang}>{lang}</option>)}
                    </select>
                </div>
            </div>
            <div className="mt-6 pt-6 border-t border-gray-700">
                <h3 className="text-lg font-semibold text-gray-200 mb-3">Quick Video Test</h3>
                <p className="text-sm text-gray-400 mb-4">
                    Quickly test your current settings with a simple prompt. This does not use any character data.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                    <div>
                        <label htmlFor="test-prompt" className="block text-sm font-medium text-gray-300 mb-2">Test Prompt</label>
                        <textarea
                            id="test-prompt"
                            value={testPrompt}
                            onChange={(e) => setTestPrompt(e.target.value)}
                            placeholder="e.g., A majestic eagle soaring through a stormy sky."
                            className="w-full p-2 bg-gray-900 border border-gray-600 rounded-md"
                            rows={4}
                        />
                        <button
                            onClick={handleGenerateTestVideo}
                            disabled={isGeneratingTestVideo || !testPrompt}
                            className="mt-3 w-full bg-teal-600 hover:bg-teal-700 disabled:bg-teal-900 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-md transition duration-200 flex items-center justify-center gap-2"
                        >
                            <FilmIcon className="w-5 h-5"/>
                            {isGeneratingTestVideo ? `Generating...` : 'Generate Test Video'}
                        </button>
                        {testVideoError && (
                            <div className="mt-3 p-3 bg-red-900/50 border border-red-700 text-red-300 text-sm rounded-md">
                                <strong>Error:</strong> {testVideoError}
                            </div>
                        )}
                    </div>
                    <div className="w-full aspect-video bg-gray-900 rounded-md flex items-center justify-center p-2">
                        {isGeneratingTestVideo && (
                            <Loader text="Generating Video..." progress={testVideoProgress} />
                        )}
                        {testVideoUrl && !isGeneratingTestVideo && (
                            <video src={testVideoUrl} controls className="w-full h-full rounded-md" />
                        )}
                        {!isGeneratingTestVideo && !testVideoUrl && (
                            <div className="text-gray-500">Your test video will appear here.</div>
                        )}
                    </div>
                </div>
            </div>
        </Section>

        <Section title="Main Idea & Inspiration" step={2}>
            <p className="text-gray-400 mb-4">Start with your core concept. You can analyze a YouTube video for inspiration or write your own idea.</p>
            
            <div className="p-4 bg-gray-900/50 rounded-lg border border-gray-700">
                <label className="block text-sm font-medium text-gray-300 mb-2">Option 1: Analyze a YouTube Video</label>
                <div className="flex flex-col sm:flex-row items-center gap-2">
                    <YouTubeIcon className="text-red-500 h-6 w-6 hidden sm:block" />
                    <input
                      type="text"
                      value={youtubeUrl}
                      onChange={(e) => setYoutubeUrl(e.target.value)}
                      placeholder="Paste a YouTube URL to analyze..."
                      className="flex-grow w-full p-3 bg-gray-700 border border-gray-600 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition duration-200"
                    />
                    <button
                      onClick={handleAnalyzeVideo}
                      disabled={isAnalyzingVideo}
                      className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-900 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-md transition duration-200 flex items-center justify-center"
                    >
                      {isAnalyzingVideo ? <Loader text="Analyzing..." /> : "Analyze Video"}
                    </button>
                </div>
                {isAnalyzingVideo && !videoAnalysis && <div className="mt-4"><Loader text="Fetching and analyzing video content... this may take a moment." /></div>}
                {videoAnalysis && (
                   <div className="mt-6 bg-gray-900/50 p-4 rounded-lg">
                      <div className="flex flex-col md:flex-row gap-4 mb-4">
                        {videoAnalysis.metadata.thumbnailUrl && (
                          <img src={videoAnalysis.metadata.thumbnailUrl} alt="Video thumbnail" className="w-full md:w-48 h-auto object-cover rounded-lg shadow-lg" />
                        )}
                        <div className="flex-grow">
                          <h3 className="text-lg font-bold">Analysis Results: <span className="text-indigo-400">{videoAnalysis.metadata.title}</span></h3>
                          <div className="text-sm text-gray-400 flex flex-wrap gap-4 mt-2">
                            <span><strong>Duration:</strong> {videoAnalysis.metadata.duration}</span>
                            <span><strong>Views:</strong> {videoAnalysis.metadata.views}</span>
                            <span><strong>Likes:</strong> {videoAnalysis.metadata.likes}</span>
                          </div>
                        </div>
                      </div>
      
                     <div className="space-y-4">
                       {videoAnalysis.segments.map(segment => (
                         <div key={segment.segment} className="bg-gray-700 p-4 rounded-md">
                           <p className="font-bold text-md mb-3 pb-2 border-b border-gray-600">{segment.timestamp} - Segment {segment.segment}</p>
                           
                           <div className="mb-3">
                             <h4 className="font-semibold text-indigo-300 flex items-center gap-2 mb-1"><UsersIcon className="w-5 h-5" /> Characters:</h4>
                             {segment.analyzedCharacters.length > 0 ? (
                               <ul className="list-disc list-inside text-sm text-gray-300 pl-2 space-y-1">
                                 {segment.analyzedCharacters.map((char, index) => (
                                   <li key={index}><strong>{char.name}:</strong> {char.description}</li>
                                 ))}
                               </ul>
                             ) : <p className="text-sm text-gray-400 italic ml-2">No characters identified in this segment.</p>}
                           </div>
      
                           <div className="mb-3">
                             <h4 className="font-semibold text-indigo-300">Environment:</h4>
                             <p className="text-sm text-gray-300 ml-2">{segment.environment}</p>
                           </div>
      
                           <div className="mb-3">
                             <h4 className="font-semibold text-indigo-300 flex items-center gap-2 mb-1"><FilmIcon className="w-5 h-5" /> Story Action:</h4>
                             <p className="text-sm text-gray-300 ml-2">{segment.storyAction}</p>
                           </div>
      
                           <div className="flex flex-wrap gap-2 mt-4">
                             <button
                               onClick={() => setMainIdea(segment.storyAction)}
                               className="text-sm bg-teal-600 hover:bg-teal-700 text-white font-semibold py-1 px-3 rounded-md transition duration-200 flex items-center gap-1.5"
                             >
                               <BookOpenIcon className="w-4 h-4" /> Use Action as Main Idea
                             </button>
                             {segment.analyzedCharacters.length > 0 && (
                                <button
                                   onClick={() => handleCreateCharactersFromAnalysis(segment.analyzedCharacters)}
                                   className="text-sm bg-purple-600 hover:bg-purple-700 text-white font-semibold py-1 px-3 rounded-md transition duration-200 flex items-center gap-1.5"
                                 >
                                   <UsersIcon className="w-4 h-4" /> Create These Characters
                                 </button>
                             )}
                           </div>
                         </div>
                       ))}
                     </div>
                      <div className="mt-6 p-4 border-t border-gray-700 text-center">
                          <button
                              onClick={handleCloneVideoFromAnalysis}
                              className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-6 rounded-lg transition duration-200 flex items-center justify-center mx-auto text-lg"
                          >
                              <SparklesIcon className="w-6 h-6 mr-2" />
                              Clone Story &amp; Characters
                          </button>
                          <p className="text-gray-400 text-sm mt-2">
                              This will use the entire analyzed story and create all identified characters for your project.
                          </p>
                      </div>
                   </div>
                )}
            </div>
            
            <div className="my-4 text-center text-gray-500 font-semibold">OR</div>
        
            <div className="p-4 bg-gray-900/50 rounded-lg border border-gray-700">
                <label htmlFor="main-idea-textarea" className="block text-sm font-medium text-gray-300 mb-2">Option 2: Write Your Own Idea</label>
                <textarea
                    id="main-idea-textarea"
                    value={mainIdea}
                    onChange={(e) => setMainIdea(e.target.value)}
                    placeholder="e.g., A stray cat befriends a lonely robot in a futuristic city."
                    className="w-full p-3 bg-gray-700 border border-gray-600 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition duration-200"
                    rows={4}
                />
                <div className="mt-3 flex justify-end">
                     <button
                        onClick={handleEnhanceStory}
                        disabled={isEnhancingStory || !mainIdea}
                        className="bg-purple-600 hover:bg-purple-700 disabled:bg-purple-900 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-md text-sm flex items-center gap-2 transition-all"
                      >
                        <SparklesIcon className="w-5 h-5" />
                        {isEnhancingStory ? 'Enhancing...' : 'Enhance Story with AI'}
                      </button>
                </div>
                <p className="text-xs text-gray-400 mt-2 text-right">This will enhance your idea and populate the "Refined Story" in Step 4.</p>
            </div>
        </Section>

        <Section title="Character Development" step={3}>
            <div className="flex flex-wrap gap-4 justify-between items-center mb-4">
              <p className="text-gray-400 flex-grow">Define the characters for your story.</p>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={handleAutoGenerateCharacters}
                  disabled={isAutoGeneratingCharacters || !(editedStorySummary || story || mainIdea)}
                  className="bg-purple-600 hover:bg-purple-700 disabled:bg-purple-900 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-md transition duration-200 flex items-center justify-center gap-2"
                >
                    <SparklesIcon className="w-5 h-5" />
                    {isAutoGeneratingCharacters ? 'Generating...' : 'Auto Generate Characters'}
                </button>
                <button onClick={addCharacter} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-md transition duration-200">
                    + Add Character
                </button>
              </div>
            </div>
            {isAutoGeneratingCharacters && <div className="mb-4"><Loader text="Identifying, refining, and generating character images from your story..." /></div>}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {characters.map((character) => (
                    <div key={character.id} className="bg-gray-700 p-4 rounded-lg shadow-md flex flex-col">
                        <div className="relative w-full aspect-[16/9] bg-gray-800 rounded-md mb-4 flex items-center justify-center group">
                            {character.isGenerating && <Loader text="Generating..." />}
                            
                            {!character.isGenerating && character.image && (
                                <>
                                    <img src={`data:${character.imageMimeType || 'image/png'};base64,${character.image}`} alt={character.name} className="w-full h-full object-contain rounded-md" />
                                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-md">
                                        <button onClick={() => handleUploadClick(character.id)} className="flex items-center gap-2 bg-white/20 hover:bg-white/30 text-white font-bold py-2 px-4 rounded-md">
                                            <UploadIcon className="w-5 h-5" />
                                            Replace Image
                                        </button>
                                    </div>
                                </>
                            )}
                            {!character.isGenerating && !character.image && (
                                <button onClick={() => handleUploadClick(character.id)} className="flex flex-col items-center justify-center text-gray-400 hover:text-white transition-colors duration-200">
                                    <UploadIcon className="w-10 h-10 mb-2" />
                                    <span>Upload Image</span>
                                </button>
                            )}
                        </div>
                        <div className="flex-grow space-y-3">
                            <input
                                type="text"
                                value={character.name}
                                onChange={(e) => handleCharacterNameChange(character.id, e.target.value)}
                                placeholder="Character Name"
                                className="w-full p-2 bg-gray-800 border border-gray-600 rounded-md"
                            />
                            <textarea
                                value={character.prompt}
                                onChange={(e) => handleCharacterPromptChange(character.id, e.target.value)}
                                placeholder="e.g., A curious orange cat with bright green eyes and a perpetually twitching tail."
                                className="w-full p-2 bg-gray-800 border border-gray-600 rounded-md text-sm"
                                rows={3}
                            />
                        </div>
                         <div className="mt-4 flex items-center gap-2">
                            <button
                                onClick={() => handleGenerateOrEditCharacterImage(character.id)}
                                disabled={character.isGenerating}
                                className="flex-grow bg-teal-600 hover:bg-teal-700 disabled:bg-teal-900 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-md transition duration-200 flex items-center justify-center gap-2"
                            >
                                <SparklesIcon className="w-5 h-5"/>
                                {character.image ? 'Edit Image' : 'Generate Image'}
                            </button>
                            <button onClick={() => handleDeleteCharacter(character.id)} className="bg-red-600 hover:bg-red-700 p-2 rounded-md transition duration-200">
                                <TrashIcon className="w-5 h-5" />
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </Section>

        <Section title="Scene Generation" step={4}>
            <p className="text-gray-400 mb-4">
              Break down your story into individual scenes. The AI will generate detailed prompts for each one.
            </p>
            <div className="bg-gray-900/50 p-4 rounded-md mb-4">
               <div className="flex justify-between items-center mb-2">
                  <label htmlFor="refined-story-textarea" className="block text-sm font-medium text-gray-300">Refined Story / Summary:</label>
                </div>
              <textarea
                  id="refined-story-textarea"
                  value={editedStorySummary}
                  onChange={(e) => setEditedStorySummary(e.target.value)}
                  placeholder="This story will be used to generate the scenes. It's populated when you use 'Enhance Story' in Step 2, or you can edit it manually here."
                  className="w-full p-3 bg-gray-700 border border-gray-600 rounded-md focus:ring-2 focus:ring-indigo-500"
                  rows={4}
                />
            </div>
             <div className="flex justify-center">
                <button
                    onClick={handleGenerateScenes}
                    disabled={isGeneratingScenes || characters.length === 0}
                    className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-900 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-lg transition duration-200 flex items-center justify-center text-lg"
                >
                    <SparklesIcon className="w-6 h-6 mr-2" />
                    {isGeneratingScenes ? 'Generating...' : 'Generate Scene Prompts'}
                </button>
             </div>
             {isGeneratingScenes && <div className="mt-4"><Loader text="Generating scenes, this may take a while..." /></div>}
        </Section>
        
        {scenes.length > 0 && (
            <Section title="Storyboard & Video Generation" step={5}>
                 <div className="flex flex-wrap justify-between items-center gap-4 mb-6">
                    <p className="text-gray-400">Review, refine, and generate the video for each scene.</p>
                    <div className="flex gap-2">
                        <button
                            onClick={handleDownloadAllPrompts}
                            className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-md transition duration-200 flex items-center gap-2"
                        >
                            <DownloadIcon className="w-5 h-5" />
                            Download Prompts
                        </button>
                        <button
                            onClick={handleCombineAndDownload}
                            disabled={!areAllVideosGenerated || isCombining}
                            className="bg-green-600 hover:bg-green-700 disabled:bg-green-900 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-md transition duration-200 flex items-center gap-2"
                        >
                            <DownloadIcon className="w-5 h-5" />
                            {isCombining ? 'Combining...' : 'Combine & Download'}
                        </button>
                      <button
                        onClick={handleMergeSelected}
                        disabled={selectedSceneIds.size === 0 || isCombining}
                        className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-900 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-md transition duration-200 flex items-center gap-2"
                      >
                        <FilmIcon className="w-5 h-5" />
                        {isCombining ? 'Merging...' : 'Merge Selected'}
                      </button>
                    </div>
                 </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {scenes.map((scene, index) => (
                        <div key={scene.id} className="bg-gray-700 p-4 rounded-lg shadow-md flex flex-col transition-all duration-300 hover:shadow-indigo-500/20 hover:ring-1 hover:ring-indigo-500">
                           <h3 className="text-lg font-bold mb-2 text-indigo-300 border-b border-gray-600 pb-2 flex items-center justify-between">
                             <span>Scene {index + 1} <span className="text-sm font-normal text-gray-400">({scene.prompt.timestamp_start} - {scene.prompt.timestamp_end})</span></span>
                             <label className="flex items-center gap-2 text-sm">
                               <input
                                 type="checkbox"
                                 checked={selectedSceneIds.has(scene.id)}
                                 onChange={() => toggleSceneSelection(scene.id)}
                                 className="w-4 h-4"
                               />
                               <span className="text-gray-300">Select</span>
                             </label>
                           </h3>
                           
                            <div className="relative w-full aspect-video bg-gray-800 rounded-md mb-4 flex items-center justify-center">
                                {scene.isGenerating ? (
                                    <Loader text={videoSettings.quality === 'free' ? 'Generating Sequence...' : 'Generating Video...'} progress={scene.generationProgress} />
                                ) : scene.videoUrl ? (
                                    <video src={scene.videoUrl} controls className="w-full h-full rounded-md" />
                                ) : scene.imageSequence && scene.imageSequence.length > 0 ? (
                                    <ImageSequencePlayer images={scene.imageSequence} />
                                ) : isPreviewingSceneId === scene.id ? (
                                    <Loader text="Generating Preview..." />
                                ) : scene.previewImage === 'failed' ? (
                                    <img src={FAILED_PREVIEW_PLACEHOLDER} alt="Preview failed" className="w-full h-full object-cover rounded-md" />
                                ) : scene.previewImage ? (
                                    <img src={`data:image/png;base64,${scene.previewImage}`} alt={`Preview for Scene ${index + 1}`} className="w-full h-full object-cover rounded-md" />
                                ) : (
                                    <div className="text-gray-500 text-sm">No preview available</div>
                                )}
                            </div>

                            <div className="flex-grow mb-4">
                               <p className="text-sm text-gray-300 italic">"{scene.summary}"</p>
                            </div>
                           
                            <div className="space-y-2 mt-auto">
                                <button
                                    onClick={() => openPromptEditor(scene)}
                                    className="w-full bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-3 rounded-md transition duration-200 text-sm flex items-center justify-center gap-2"
                                >
                                    <EyeIcon className="w-4 h-4" />
                                    View & Edit Full Prompt
                                </button>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => handleGenerateScenePreview(scene.id)}
                                        disabled={isPreviewingSceneId === scene.id || scene.isGenerating}
                                        className="w-1/2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-900 disabled:cursor-not-allowed text-white font-bold py-2 px-3 rounded-md transition duration-200 text-sm"
                                    >
                                        {isPreviewingSceneId === scene.id ? '...' : 'Preview'}
                                    </button>
                                    <button
                                        onClick={() => handleGenerateSceneOutput(scene.id)}
                                        disabled={scene.isGenerating || isPreviewingSceneId !== null}
                                        className="w-1/2 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-900 disabled:cursor-not-allowed text-white font-bold py-2 px-3 rounded-md transition duration-200 text-sm"
                                    >
                                        {scene.isGenerating ? 'Generating...' : videoSettings.quality === 'free' ? 'Generate Sequence' : 'Generate Video'}
                                    </button>
                                </div>
                                {scene.audioUrl && <audio src={scene.audioUrl} controls className="w-full h-8 mt-2" />}
                                <button
                                    onClick={() => handleGenerateSceneAudio(scene.id)}
                                    disabled={scene.isGeneratingAudio || !elevenLabsApiKey || elevenLabsVoices.length === 0}
                                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-900 disabled:cursor-not-allowed text-white font-bold py-2 px-3 rounded-md transition duration-200 text-sm flex items-center justify-center gap-2"
                                >
                                    {scene.isGeneratingAudio ? <Loader text="" /> : (scene.audioUrl ? 'Regenerate Audio' : 'Generate Audio')}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </Section>
        )}
      </main>
    </div>
  );
};

export default App;
