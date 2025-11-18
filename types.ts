// types.ts

export interface Character {
  id: string;
  name: string;
  image: string; // base64 encoded image
  imageMimeType?: string;
  prompt: string;
  isGenerating: boolean;
}

export interface EvolvingAsset {
  id: string;
  name: string;
  type: 'Object' | 'Creature';
  initialPrompt: string;
  finalPrompt: string;
  evolutionPrompts: string[];
  isGeneratingEvolution: boolean;
}

// --- New Video Analysis Interface ---
export interface AnalyzedCharacter {
  name: string;
  description: string;
}

export interface VideoAnalysisSegment {
  segment: number;
  timestamp: string;
  analyzedCharacters: AnalyzedCharacter[];
  environment: string;
  storyAction: string;
}

export interface VideoMetadata {
  title: string;
  duration: string;
  views: string;
  likes: string;
  thumbnailUrl: string;
}

export interface VideoAnalysis {
  metadata: VideoMetadata;
  segments: VideoAnalysisSegment[];
}


// --- New Detailed Scene Prompt Interfaces ---

export interface SceneCharacter {
  id: string;
  name: string;
  description: string;
}

export interface SceneBackground {
  id: string;
  name: string;
  description: string;
  lighting: string;
  atmosphere: string;
}

export interface SceneCamera {
  shot_type: string;
  angle: string;
  movement: string;
}

export interface SceneFoley {
  sound_effects: string[];
  ambient_sounds: string;
}

export interface SceneFX {
  visual_effects: string;
  transitions: string;
}

export interface ScenePrompt {
  scene_id: string;
  timestamp_start: string;
  timestamp_end: string;
  duration_sec: number;
  visual_style: string;
  character_lock: Record<string, SceneCharacter>;
  background_lock: Record<string, SceneBackground>;
  camera: SceneCamera;
  foley_and_ambience: SceneFoley;
  fx: SceneFX;
  dialogue: string[];
  complete_prompt: string;
}


// --- Updated Scene Interface ---

export interface Scene {
  id: string;
  summary: string;
  prompt: ScenePrompt; // Changed from string to the new detailed structure
  videoUrl?: string;
  isGenerating: boolean;
  operation?: any;
  isSelected: boolean;
  isRefining?: boolean;
  generationProgress?: number;
  previewImage?: string;
  imageSequence?: string[];
  audioUrl?: string;
  isGeneratingAudio?: boolean;
}

export interface StoryConcept {
  title: string;
  summary: string;
}

export type AspectRatio = "16:9" | "9:16";
export type VideoQuality = "standard" | "high" | "free" | "flow";

export interface VideoSettings {
  aspectRatio: AspectRatio;
  duration: number; // in seconds
  style: string;
  environment: string;
  characterConsistency: boolean;
  quality: VideoQuality;
  apiCallRate: number; // in milliseconds
  voiceId: string;
  language: string;
}

export interface FinalVideoMeta {
  title: string;
  description:string;
  hashtags: string[];
  thumbnail: string; // base64 encoded image
}

export interface ElevenLabsVoice {
  id: string;
  name: string;
}

// FIX: Resolved a type conflict by defining the AIStudio interface within the
// global scope and using it for window.aistudio. This aligns this declaration
// with other potential declarations of window.aistudio.
declare global {
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }

  interface Window {
    aistudio?: AIStudio;
  }
}
