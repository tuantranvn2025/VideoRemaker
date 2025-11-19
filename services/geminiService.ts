import { GoogleGenAI, Type, GenerateContentResponse, Modality } from "@google/genai";
import { Character, Scene, VideoSettings, FinalVideoMeta, VideoQuality, StoryConcept, AspectRatio, ScenePrompt, EvolvingAsset, VideoAnalysis, SceneCharacter, SceneBackground, SceneCamera, SceneFoley, SceneFX } from "../types";
import { appLogger } from "../utils/logger";
import * as flowService from './flowService';

// NOTE: This service will try to read the API key from localStorage (renderer)
// falling back to process.env.API_KEY for environments where localStorage
// isn't available (e.g., CI or certain server contexts).
const resolveApiKey = () => {
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            const k = window.localStorage.getItem('GEMINI_API_KEY');
            if (k && k.trim().length > 0) return k.trim();
        }
    } catch (e) {
        // ignore
    }
    return process.env.API_KEY;
};

/**
 * Quick client-side check for prompts that reference minors or other sensitive terms
 * which may trigger safety filters in image models. This is intentionally conservative
 * and meant to prevent repeated API calls that will be blocked.
 */
export const isPromptAllowed = (prompt: string): { allowed: boolean; reason?: string } => {
    if (!prompt || prompt.trim().length === 0) return { allowed: false, reason: 'Empty prompt' };
    const lowered = prompt.toLowerCase();
    const minorTerms = ['child', 'children', 'kid', 'kids', 'minor', 'infant', 'toddler', 'baby', 'young child', 'underage'];
    const sensitiveTerms = ['diaper', 'nudity', 'sexual', 'sex', 'porn', 'inappropriate'];
    for (const t of minorTerms) {
        if (lowered.includes(t)) return { allowed: false, reason: 'Prompt references minors or children which is disallowed.' };
    }
    for (const t of sensitiveTerms) {
        if (lowered.includes(t)) return { allowed: false, reason: 'Prompt contains sensitive terms that may be blocked.' };
    }
    return { allowed: true };
};

const getGenAI = () => new GoogleGenAI({ apiKey: resolveApiKey() });

export const validateApiKey = async (key: string): Promise<{ valid: boolean; message?: string }> => {
    try {
        if (!key || key.trim().length === 0) return { valid: false, message: 'Empty key' };
        const ai = new GoogleGenAI({ apiKey: key });
        // Make a very small request to validate the key. Use a cheap model and tiny output.
        await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: 'ping', config: { maxOutputTokens: 1 } as any });
        return { valid: true };
    } catch (err: any) {
        return { valid: false, message: err?.message || String(err) };
    }
};

export const analyzeYouTubeVideo = async (url: string): Promise<VideoAnalysis> => {
    const systemInstruction = `You are an expert YouTube video analyst. Your task is to analyze the video provided directly via a file URI and structure your findings as a JSON object.

      **CRITICAL INSTRUCTIONS:**
      1.  **Analyze Video Content:** You will be given a direct link to a video. Analyze its visual and (if possible) audio content to extract the requested information. If you cannot process the video, you must still return a valid JSON object with empty or placeholder values and a note in the 'title' field indicating information was not found.
      2.  **Extract Metadata:** Find the following if available:
          *   \`title\`: The full title.
          *   \`duration\`: The duration (e.g., "3:45"). If unknown, use "N/A".
          *   \`views\`: The number of views (e.g., "1.2M views"). If unknown, use "N/A".
          *   \`likes\`: The number of likes (e.g., "87K likes"). If unknown, use "N/A".
          *   \`thumbnailUrl\`: A direct, public URL to the video's thumbnail image. If not found, use an empty string "".
      3.  **Scene Segmentation:** Based on the video content, create a few logical scene segments. If the video is short, create one segment summarizing the video's topic.
      4.  **Detailed Scene Description:** For EACH scene, provide:
          *   \`segment\`: Sequence number (starting from 1).
          *   \`timestamp\`: Time marker (e.g., "0:00 - 0:08"). If unknown, use "N/A".
          *   \`analyzedCharacters\`: An array of objects for each character in the scene. Each object MUST have \`name\` and \`description\` (visual appearance, personality). If no characters, use an empty array [].
          *   \`environment\`: A detailed description of the scene's setting, environment, and key props.
          *   \`storyAction\`: A detailed, cinematic description of the actions and events happening in the scene.
      5.  **JSON Output Format:** You MUST return a single, valid JSON object. It MUST contain "metadata" and "segments" keys. Do not wrap it in markdown. Do not add any other text or explanation. If you cannot find info, return a valid JSON with placeholder values.`;

    const promptText = `Please thoroughly analyze this YouTube video and return the result in the JSON format as per the system instructions.`;

    try {
        appLogger.add('API_REQUEST', 'geminiService.analyzeYouTubeVideo', { model: 'gemini-2.5-pro', url });
        const ai = getGenAI();
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-pro',
            contents: [
                { text: promptText },
                { fileData: { fileUri: url, mimeType: 'video/mp4' } }
            ],
            config: {
                systemInstruction: systemInstruction,
            }
        });
        
        const jsonMatch = response.text.match(/{[\s\S]*}/);
        if (!jsonMatch) {
            console.error("Raw AI response on JSON match failure:", response.text);
            throw new Error("No valid JSON object found in the AI's response.");
        }
        
        const jsonString = jsonMatch[0];
        const result = JSON.parse(jsonString);

        if (!result.metadata || !result.segments) {
            throw new Error("AI returned an invalid structure. Expected 'metadata' and 'segments' keys.");
        }
        appLogger.add('API_RESPONSE', 'geminiService.analyzeYouTubeVideo SUCCESS', { result });
        return result;
    } catch (error) {
        console.error("Error analyzing YouTube video:", error);
        throw error;
    }
};


export const generateStoryConcepts = async (mainIdea: string, count: number, videoStyle: string, duration: number): Promise<StoryConcept[]> => {
  const numScenes = Math.ceil(duration / 8);
  const prompt = `You are a creative writer and expert in viral short-form video content. Based on the main idea for a series: "${mainIdea}", and a desired visual style of "${videoStyle}", generate a list of exactly ${count} distinct story concepts. The final video will be approximately ${duration} seconds long, so each summary should be detailed enough to be logically divided into roughly ${numScenes} scenes (at 8 seconds per scene). For each concept, provide a catchy, short title and a concise one-paragraph summary. The summary should be engaging, suitable for the specified style, and easily expandable into a full video script. Return the result as a single JSON object with a "concepts" array.`;

  try {
    appLogger.add('API_REQUEST', 'geminiService.generateStoryConcepts', { model: 'gemini-2.5-pro', mainIdea, count, videoStyle, duration });
    const ai = getGenAI();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-pro',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            concepts: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  summary: { type: Type.STRING }
                },
                required: ["title", "summary"]
              }
            }
          }
        }
      }
    });
    const result = JSON.parse(response.text);
    appLogger.add('API_RESPONSE', 'geminiService.generateStoryConcepts SUCCESS', { conceptCount: result.concepts?.length });
    return result.concepts || [];
  } catch (error) {
    console.error("Error generating story concepts:", error);
    throw error;
  }
};

export const enhanceStory = async (story: string, characters: Character[]): Promise<string> => {
    const characterProfiles = characters.length > 0
        ? characters.map(c => `- **${c.name}**: ${c.prompt}`).join('\n')
        : 'No specific characters defined.';

    const prompt = `
    You are an expert in creating viral short-form video content for platforms like YouTube Shorts and TikTok. Your task is to rewrite the following story summary to maximize its engagement potential.

    **Core Story Idea:**
    "${story}"

    **Main Characters:**
    ${characterProfiles}

    **CRITICAL Instructions:**
    1.  **Create a Strong Hook:** The first sentence MUST be an incredibly strong hook that grabs the viewer's attention immediately.
    2.  **Increase Virality:** Enhance the narrative to include elements of surprise, high emotion, or a satisfying resolution that encourages sharing.
    3.  **Cinematic & Descriptive:** Make the language more visual and cinematic.
    4.  **Preserve Core Plot:** You MUST adhere to the original plot and the provided character descriptions. Do not introduce new characters or fundamentally change the story's outcome.
    5.  **Concise Output:** Return ONLY the enhanced story text. Do not add any conversational preamble, sign-off, or labels like "Enhanced Story:".
    `;
    try {
        appLogger.add('API_REQUEST', 'geminiService.enhanceStory', { model: 'gemini-2.5-pro', storyLength: story.length });
        const ai = getGenAI();
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-pro',
            contents: prompt,
        });
        appLogger.add('API_RESPONSE', 'geminiService.enhanceStory SUCCESS', { enhancedStoryLength: response.text.trim().length });
        return response.text.trim();
    } catch (error) {
        console.error("Error enhancing story:", error);
        throw error;
    }
};


export const suggestCharacterPrompts = async (story: string, videoStyle: string): Promise<{ name: string; prompt: string }[]> => {
  try {
    appLogger.add('API_REQUEST', 'geminiService.suggestCharacterPrompts', { model: 'gemini-2.5-flash', storyLength: story.length, videoStyle });
    const ai = getGenAI();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Based on the following video story and its intended visual style, identify the main characters and suggest a name and a descriptive prompt for each (2-3 characters total). The name should be a single, proper, and creative name (e.g., 'Leo', 'Mila'), not a generic role like 'owner' or 'boy'. Each prompt should be a concise but descriptive sentence suitable for an image generation model. The character descriptions MUST reflect the specified aesthetic.
      STORY: "${story}"
      VISUAL STYLE: "${videoStyle}"`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            characters: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  prompt: { type: Type.STRING }
                },
                required: ["name", "prompt"],
              }
            }
          }
        }
      }
    });
    const result = JSON.parse(response.text);
    appLogger.add('API_RESPONSE', 'geminiService.suggestCharacterPrompts SUCCESS', { characterCount: result.characters?.length });
    return result.characters || [];
  } catch (error) {
    console.error("Error suggesting character prompts:", error);
    throw error;
  }
};

export const enhanceCharacterPrompt = async (originalPrompt: string): Promise<string> => {
  const prompt = `
  You are an expert prompt engineer for an AI image generator. Your task is to refine a character description. The goal is to generate a single, isolated character on a plain white background, perfect for a character sheet.
  Analyze the user's prompt and rewrite it to focus ONLY on the main character's physical appearance, clothing, and demeanor.
  
  **CRITICAL RULES:**
  1.  **Isolation:** The character MUST be isolated. REMOVE any mention of other characters, animals, or objects. The character should not be holding anything.
  2.  **No Action:** REMOVE any description of actions, verbs, or complex scenes. The character should be in a neutral, standing pose.
  3.  **No Background:** REMOVE any description of the background or environment. The background MUST be solid white.
  4.  **Camera Focus:** The character should be facing forward, looking directly at the camera.
  5.  **Concise Output:** The output should be a single, concise, descriptive phrase.

  User Prompt: "${originalPrompt}"

  Return ONLY the refined prompt text.
  Example Input: "A brave knight with a gleaming sword, standing victorious over a defeated dragon on a mountaintop at sunset."
  Example Output: "A brave knight in gleaming silver armor with a red plume on his helmet, stoic expression, standing, facing the camera."
  `;

  try {
    appLogger.add('API_REQUEST', 'geminiService.enhanceCharacterPrompt', { model: 'gemini-2.5-flash', originalPrompt });
    const ai = getGenAI();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    appLogger.add('API_RESPONSE', 'geminiService.enhanceCharacterPrompt SUCCESS');
    return response.text.trim();
  } catch (error) {
    console.error("Error enhancing character prompt:", error);
    throw error;
  }
};

export const generateCharacter = async (prompt: string, videoStyle: string, name?: string): Promise<{ name: string; image: string }> => {
  try {
        // Server-side defensive safety check (in addition to client-side check)
        const promptCheck = isPromptAllowed(prompt || '');
        if (!promptCheck.allowed) {
            appLogger.add('API_RESPONSE', 'geminiService.generateCharacter PROMPT_BLOCKED', { reason: promptCheck.reason, promptSnippet: (prompt || '').slice(0,200) });
            throw new Error(`Prompt blocked by safety checks: ${promptCheck.reason}`);
        }
    appLogger.add('API_REQUEST', 'geminiService.generateCharacter', { modelImage: 'gemini-2.5-flash-image', modelName: 'gemini-2.5-flash', prompt, videoStyle, name });
    const ai = getGenAI();
    let finalName = name;
    
    if (!finalName || finalName.trim() === '') {
      const nameResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Based on the character description "${prompt}", suggest a single, simple, one-word proper name for them (e.g., 'Leo', 'Mila'), not a generic role like 'owner' or 'boy'. Only return the name.`,
      });
      finalName = nameResponse.text.trim();
    }

    const imageGenPrompt = `A single character for a character sheet, in the style of ${videoStyle}: ${prompt}. Full body shot, standing, facing forward. Isolated on a plain, solid white background. No other objects, shadows, or scenery.`;
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [{ text: imageGenPrompt }]
      },
      config: {
        responseModalities: [Modality.IMAGE],
      },
    });

        const candidate = response.candidates && response.candidates[0];
        if (!candidate) {
            appLogger.add('API_RESPONSE', 'geminiService.generateCharacter FAILED', { response });
            throw new Error('No candidates returned from image generation API. Response logged.');
        }
        if (candidate.finishReason === 'SAFETY') {
            appLogger.add('API_RESPONSE', 'geminiService.generateCharacter SAFETY_BLOCK', { response });
            throw new Error('Image generation blocked by safety filters.');
        }
        if (!candidate.content) {
            appLogger.add('API_RESPONSE', 'geminiService.generateCharacter FAILED_NO_CONTENT', { candidate });
            throw new Error('Image generation candidate missing content object. Response logged for debugging.');
        }
        const parts = candidate.content.parts;
        if (!parts || !Array.isArray(parts) || parts.length === 0) {
            appLogger.add('API_RESPONSE', 'geminiService.generateCharacter FAILED_NO_PARTS', { candidate });
            throw new Error('Image generation response missing content parts. Response logged for debugging.');
        }

        for (const part of parts) {
            if (part?.inlineData) {
                appLogger.add('API_RESPONSE', 'geminiService.generateCharacter SUCCESS', { name: finalName, imageReceived: true });
                return { name: finalName!, image: part.inlineData.data };
            }
        }
        appLogger.add('API_RESPONSE', 'geminiService.generateCharacter FAILED_NO_INLINE', { candidate });
        throw new Error('Image data not found in API response (no inlineData in parts).');
  } catch (error) {
    console.error("Error generating character:", error);
    throw error;
  }
};

export const editCharacterImage = async (base64Image: string, prompt: string, mimeType: string = 'image/png'): Promise<string> => {
  try {
        // Server-side defensive safety check
        const promptCheck = isPromptAllowed(prompt || '');
        if (!promptCheck.allowed) {
            appLogger.add('API_RESPONSE', 'geminiService.editCharacterImage PROMPT_BLOCKED', { reason: promptCheck.reason, promptSnippet: (prompt || '').slice(0,200) });
            throw new Error(`Prompt blocked by safety checks: ${promptCheck.reason}`);
        }
    appLogger.add('API_REQUEST', 'geminiService.editCharacterImage', { model: 'gemini-2.5-flash-image', prompt });
    const ai = getGenAI();
    const editPrompt = `Refine the character in the provided image based on the following description. Maintain the existing art style, character pose, and solid white background. Only change the features mentioned in the description. Description: "${prompt}"`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Image,
              mimeType: mimeType,
            },
          },
          {
            text: editPrompt,
          },
        ],
      },
      config: {
          responseModalities: [Modality.IMAGE],
      },
    });

        const candidate = response.candidates && response.candidates[0];
        if (!candidate) {
            appLogger.add('API_RESPONSE', 'geminiService.editCharacterImage FAILED', { response });
            throw new Error('No candidates returned from image edit API. Response logged.');
        }
        if (candidate.finishReason === 'SAFETY') {
            appLogger.add('API_RESPONSE', 'geminiService.editCharacterImage SAFETY_BLOCK', { response });
            throw new Error('Image edit blocked by safety filters.');
        }
        if (!candidate.content) {
            appLogger.add('API_RESPONSE', 'geminiService.editCharacterImage FAILED_NO_CONTENT', { candidate });
            throw new Error('Edited image candidate missing content object. Response logged.');
        }
        const parts = candidate.content.parts;
        if (!parts || !Array.isArray(parts) || parts.length === 0) {
            appLogger.add('API_RESPONSE', 'geminiService.editCharacterImage FAILED_NO_PARTS', { candidate });
            throw new Error('Edited image response missing content parts. Response logged.');
        }

        for (const part of parts) {
            if (part?.inlineData) {
                appLogger.add('API_RESPONSE', 'geminiService.editCharacterImage SUCCESS', { imageReceived: true });
                return part.inlineData.data;
            }
        }
        appLogger.add('API_RESPONSE', 'geminiService.editCharacterImage FAILED_NO_INLINE', { candidate });
        throw new Error('Edited image data not found in API response (no inlineData in parts).');
  } catch (error) {
    console.error("Error editing character image:", error);
    throw error;
  }
};

export const generateCharactersFromStory = async (story: string, videoStyle: string): Promise<{ name: string; prompt: string; image: string; imageMimeType: string }[]> => {
    appLogger.add('API_REQUEST', 'geminiService.generateCharactersFromStory', { storyLength: story.length, videoStyle });

    // Step 1: Suggest characters based on the story.
    const suggestedCharacters = await suggestCharacterPrompts(story, videoStyle);
    if (!suggestedCharacters || suggestedCharacters.length === 0) {
        appLogger.add('INFO', 'geminiService.generateCharactersFromStory', { message: 'No characters suggested by the model.' });
        return [];
    }

    // Step 2: For each suggested character, refine prompt and generate image.
    const characterGenerationPromises = suggestedCharacters.map(async (char) => {
        try {
            // Refine the prompt to be perfect for a character sheet (isolated, white background, etc.)
            const refinedPrompt = await enhanceCharacterPrompt(char.prompt);
            
            // Generate the character image with the refined prompt.
            const { name, image } = await generateCharacter(refinedPrompt, videoStyle, char.name);

            return {
                name,
                prompt: refinedPrompt, // Return the refined prompt for user visibility
                image,
                imageMimeType: 'image/png' // The model used in generateCharacter returns PNG
            };
        } catch (error) {
            console.error(`Failed to automatically generate character ${char.name}:`, error);
            // Return null for failed characters so Promise.all doesn't fail completely.
            return null;
        }
    });

    const generatedCharacters = (await Promise.all(characterGenerationPromises))
        .filter(Boolean) as { name: string; prompt: string; image: string; imageMimeType: string }[];

    appLogger.add('API_RESPONSE', 'geminiService.generateCharactersFromStory SUCCESS', { characterCount: generatedCharacters.length });
    return generatedCharacters;
};

export const generateEnvironmentDescription = async (story: string): Promise<string> => {
  const prompt = `Based on the following story, write a single, concise but descriptive sentence that captures the primary environment or setting. This description will be used to guide the visual background of a video. Focus on the key visual elements of the world where the story takes place.

Story: "${story}"

Return ONLY the environment description text.`;
  try {
    appLogger.add('API_REQUEST', 'geminiService.generateEnvironmentDescription', { model: 'gemini-2.5-flash', storyLength: story.length });
    const ai = getGenAI();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    appLogger.add('API_RESPONSE', 'geminiService.generateEnvironmentDescription SUCCESS', { description: response.text.trim() });
    return response.text.trim();
  } catch (error) {
    console.error("Error generating environment description:", error);
    throw error;
  }
};


export const generateScenes = async (
    story: string,
    characters: Character[],
    evolvingAssets: EvolvingAsset[],
    settings: VideoSettings,
): Promise<Pick<Scene, 'summary' | 'prompt'>[]> => {
    const numScenes = Math.ceil(settings.duration / 8);
    const sceneDuration = 8; // Use a number for calculations

    const characterProfiles = characters.map(c => `- **${c.name}**: ${c.prompt}`).join('\n');

    // --- Schema Definition for the entire scene array ---
    const sceneCharacterSchema = {
        type: Type.OBJECT,
        properties: {
            id: { type: Type.STRING },
            name: { type: Type.STRING },
            description: { type: Type.STRING, description: "Description of character appearance and expression for this scene." },
        },
        required: ["id", "name", "description"],
    };

    const sceneBackgroundSchema = {
        type: Type.OBJECT,
        properties: {
            id: { type: Type.STRING },
            name: { type: Type.STRING },
            description: { type: Type.STRING, description: "Description of the scene's setting and key props." },
            lighting: { type: Type.STRING, description: "Description of the lighting." },
            atmosphere: { type: Type.STRING, description: "Description of the atmosphere." },
        },
        required: ["id", "name", "description", "lighting", "atmosphere"],
    };

    const sceneCameraSchema = { type: Type.OBJECT, properties: { shot_type: { type: Type.STRING }, angle: { type: Type.STRING }, movement: { type: Type.STRING } }, required: ["shot_type", "angle", "movement"] };
    const sceneFoleySchema = { type: Type.OBJECT, properties: { sound_effects: { type: Type.ARRAY, items: { type: Type.STRING } }, ambient_sounds: { type: Type.STRING } }, required: ["sound_effects", "ambient_sounds"] };
    const sceneFXSchema = { type: Type.OBJECT, properties: { visual_effects: { type: Type.STRING }, transitions: { type: Type.STRING } }, required: ["visual_effects", "transitions"] };

    const characterLockProperties = characters.reduce((acc, char) => {
        const key = `${char.name.toUpperCase().replace(/\s/g, '_')}`;
        acc[key] = sceneCharacterSchema;
        return acc;
    }, {} as Record<string, object>);

    if (Object.keys(characterLockProperties).length === 0) {
        characterLockProperties["CHARACTER_1"] = sceneCharacterSchema;
    }

    const scenePromptSchema = {
        type: Type.OBJECT,
        properties: {
            scene_id: { type: Type.STRING },
            timestamp_start: { type: Type.STRING },
            timestamp_end: { type: Type.STRING },
            duration_sec: { type: Type.NUMBER },
            visual_style: { type: Type.STRING },
            character_lock: { type: Type.OBJECT, properties: characterLockProperties, description: "Object where each key is a unique character ID (e.g., 'LEO') and the value contains details for this scene." },
            background_lock: { type: Type.OBJECT, properties: { "BG_1": sceneBackgroundSchema }, description: "Object with a single key for the background details." },
            camera: sceneCameraSchema,
            foley_and_ambience: sceneFoleySchema,
            fx: sceneFXSchema,
            dialogue: { type: Type.ARRAY, items: { type: Type.STRING } },
            complete_prompt: { type: Type.STRING, description: "A detailed, cinematic paragraph of 150-300 words describing the entire scene, combining all elements. This is the main prompt for video generation." },
        },
        required: ["scene_id", "timestamp_start", "timestamp_end", "duration_sec", "visual_style", "character_lock", "background_lock", "camera", "foley_and_ambience", "fx", "dialogue", "complete_prompt"]
    };

    const fullSchema = {
        type: Type.OBJECT,
        properties: {
            scenes: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        summary: { type: Type.STRING, description: "A very brief, one-sentence summary of the scene's action." },
                        prompt: scenePromptSchema
                    },
                    required: ["summary", "prompt"]
                }
            }
        },
        required: ["scenes"]
    };
    // --- End Schema Definition ---

    const prompt = `
    You are an expert video director and a prompt engineer for an advanced AI video generation model. Your task is to generate the JSON for a complete cinematic storyboard, divided into multiple scenes, following a very specific and detailed schema.

    **Total Scenes to Generate:** ${numScenes}
    **Approximate Duration per scene:** ${sceneDuration} seconds.

    **Main Story Script:**
    "${story}"

    **Available Characters (use their full descriptions when crafting prompts):**
    ${characterProfiles}
    
    **CRITICAL Instructions:**
    1.  **Decomposition:** Decompose the entire story into exactly ${numScenes} distinct scenes. Each scene should logically follow the previous one. Calculate \`timestamp_start\` and \`timestamp_end\` for each scene.
    2.  **Strict JSON Output:** You MUST generate a single JSON object with a single key "scenes". The value of "scenes" must be an array of objects. Each object in the array must contain a 'summary' and a 'prompt' key, where the 'prompt' value is a JSON object matching the schema.
    3.  **Populate JSON Fields for EACH scene's 'prompt' object:**
        - **scene_id, timestamps, duration_sec:** Calculate and populate these fields accurately.
        - **visual_style:** Use this exact style: "${settings.style}".
        - **character_lock:** Create a key for each character in the scene (e.g., "LEO", "ROCKY"). The value should be an object with their ID, name, and a detailed description of their specific appearance, pose, and expression for THIS scene. The description should be based on the main character profile but adapted for the scene's action.
        - **background_lock:** Describe the environment, lighting, and atmosphere for this specific scene.
        - **camera, foley_and_ambience, fx, dialogue:** Fill these with cinematic and descriptive details.
        - **complete_prompt:** THIS IS THE MOST IMPORTANT FIELD. Write a rich, cinematic, and detailed paragraph of **150-300 words**. This prompt must synthesize all other information (characters, background, action, camera, style) into a complete, comprehensive description for the video generation model. It must be descriptive enough to create the entire scene from this text alone. It must include the character descriptions from the main character profiles, adapted for the scene.
    4.  **Character Naming:** In all descriptive fields (like \`summary\`, \`complete_prompt\`, and \`dialogue\`), you MUST refer to characters by their specific given names (e.g., "${characters.map(c => c.name).filter(Boolean).join(', ')}").
    5.  **Add Dialogue in ${settings.language}:** To make the story more lively, you MUST add meaningful dialogue to the \`dialogue\` array for scenes with character interactions. The dialogue must be natural, in-character, and reveal personality. All dialogue MUST be written in **${settings.language}**. Format it as ["Character Name: Line of dialogue."]. Do not leave dialogue empty unless a scene is explicitly silent.

    Return ONLY the single JSON object containing the "scenes" array, adhering strictly to the provided JSON schema.
    `;

    try {
        appLogger.add('API_REQUEST', 'geminiService.generateScenes', { model: 'gemini-2.5-pro', storyLength: story.length, characterCount: characters.length, settings });
        const ai = getGenAI();
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-pro',
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: fullSchema,
            }
        });

        const candidate = response.candidates?.[0];
        if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
            if (candidate.finishReason === 'MAX_TOKENS') {
                 throw new Error("The AI's response was too long and was truncated. Please try reducing the video duration or simplifying the story to reduce the output size.");
            }
            if (candidate.finishReason === 'SAFETY') {
                throw new Error("Scene generation was blocked due to safety settings.");
            }
            throw new Error(`Scene generation stopped for an unexpected reason: ${candidate.finishReason}.`);
        }
        
        const result = JSON.parse(response.text);
        if (!result.scenes || !Array.isArray(result.scenes)) {
             console.error("Full AI response on JSON parse error:", response.text);
             throw new Error("AI returned an invalid structure. Expected a 'scenes' array.");
        }
        appLogger.add('API_RESPONSE', 'geminiService.generateScenes SUCCESS', { sceneCount: result.scenes.length });
        return result.scenes;

    } catch (error) {
        console.error(`Error generating scenes:`, error);
        if (error instanceof SyntaxError) {
            // It's a JSON parsing error
            const rawResponseForDebug = (error as any).response?.text || 'No raw response available.';
            console.error("The AI's response was not valid JSON. Raw response:", rawResponseForDebug);
        }
        throw new Error(`Failed to generate scenes. Original error: ${(error as Error).message}`);
    }
};

export const refineScenePrompt = async (originalPrompt: ScenePrompt, storyContext: string, previousScenePrompt?: ScenePrompt): Promise<ScenePrompt> => {
    const continuityInstruction = previousScenePrompt
        ? `
    **CRITICAL CONTINUITY RULE:** This scene MUST logically follow the previous scene.
    Previous Scene JSON: ${JSON.stringify(previousScenePrompt, null, 2)}
    Analyze the 'character_lock' descriptions and 'complete_prompt' in the previous scene. The refined prompt for the current scene must start exactly where the previous scene left off.
    `
        : '';

    const prompt = `
    You are an expert prompt engineer for an AI video generator. Your task is to refine a scene prompt provided as a JSON object.

    **Input JSON Prompt to Refine:**
    ${JSON.stringify(originalPrompt, null, 2)}
    
    **Your Goal:**
    Refine the values within the JSON to be more vivid, cinematic, and descriptive, while maintaining the overall narrative action. Focus on improving the \`complete_prompt\`, ensuring it is between 150-300 words and highly detailed. Also enhance \`character_lock\`, \`background_lock\`, and \`camera\` descriptions.

    **CRITICAL Rules:**
    1.  **Strict JSON Output:** The output MUST be a single, valid JSON object with the exact same structure as the input.
    2.  **Preserve Core Info:** Do not change \`scene_id\`, timestamps, or \`duration_sec\`.
    3.  **Enhance, Don't Replace:** Improve the descriptions, don't invent a new scene.

    ${continuityInstruction}

    **Overall Story Context:** "${storyContext}"

    Return ONLY the single, refined JSON object.
    `;
    try {
        appLogger.add('API_REQUEST', 'geminiService.refineScenePrompt', { model: 'gemini-2.5-flash', sceneId: originalPrompt.scene_id });
        const ai = getGenAI();
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
             config: {
                responseMimeType: "application/json",
             }
        });
        
        const jsonMatch = response.text.match(/{[\s\S]*}/);
        if (!jsonMatch) {
            console.error("Raw AI response on JSON match failure:", response.text);
            throw new Error("No valid JSON object found in the AI's response for refining scene prompt.");
        }
        const result = JSON.parse(jsonMatch[0]);
        appLogger.add('API_RESPONSE', 'geminiService.refineScenePrompt SUCCESS', { sceneId: result.scene_id });
        return result;
    } catch (error) {
        console.error("Error refining scene prompt:", error);
        throw error;
    }
};

export const regeneratePromptFromSummary = async (summary: string, storyContext: string, videoStyle: string, characters: Character[], previousScenePrompt?: ScenePrompt): Promise<ScenePrompt> => {
     const characterProfiles = characters.map(c => `- **${c.name}**: ${c.prompt}`).join('\n');

    const continuityInstruction = previousScenePrompt ? `
    **CRITICAL CONTINUITY RULE:** This scene MUST logically follow the previous scene.
    Previous Scene JSON: ${JSON.stringify(previousScenePrompt, null, 2)}
    Ensure the character's starting location and action are consistent.
    ` : '';

    const prompt = `
    You are an expert video director and prompt engineer. Your task is to create a single, detailed JSON video prompt based on a scene summary.

    **Scene Summary to expand on:**
    "${summary}"

    **Overall Story Context:**
    "${storyContext}"

    **Available Characters:**
    ${characterProfiles}
    
    **CRITICAL Instructions:**
    1.  **Strict JSON Output:** Generate a single JSON object following the structure provided in the example.
    2.  **Populate All Fields:** Based on the summary, story context, and characters, fill in all fields of the JSON object descriptively.
    3.  **Visual Style:** Use this exact style for 'visual_style': "${videoStyle}".
    4.  **Complete Prompt:** The 'complete_prompt' field is most important. Write a rich, cinematic, and detailed paragraph of **150-300 words** that synthesizes all information.
    
    ${continuityInstruction}

    **Example JSON structure to follow:**
    {
      "scene_id": "1", "timestamp_start": "0:00", "timestamp_end": "0:08", "duration_sec": 8, "visual_style": "...",
      "character_lock": { "CHARACTER_KEY": { "id": "...", "name": "...", "description": "..." } },
      "background_lock": { "BG_1": { "id": "BG_1", "name": "...", "description": "...", "lighting": "...", "atmosphere": "..." } },
      "camera": { "shot_type": "...", "angle": "...", "movement": "..." },
      "foley_and_ambience": { "sound_effects": [...], "ambient_sounds": "..." },
      "fx": { "visual_effects": "...", "transitions": "..." },
      "dialogue": ["..."],
      "complete_prompt": "A detailed 150-300 word cinematic description goes here..."
    }

    Return ONLY the single, valid JSON object. Do not add any conversational preamble.
    `;
    
    try {
        appLogger.add('API_REQUEST', 'geminiService.regeneratePromptFromSummary', { model: 'gemini-2.5-pro', summary, videoStyle });
        const ai = getGenAI();
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-pro',
            contents: prompt,
            config: {
                responseMimeType: "application/json",
            }
        });
        
        const jsonMatch = response.text.match(/{[\s\S]*}/);
        if (!jsonMatch) {
            console.error("Raw AI response on JSON match failure:", response.text);
            throw new Error("No valid JSON object found in the AI's response for regenerating prompt.");
        }
        const result = JSON.parse(jsonMatch[0]);
        appLogger.add('API_RESPONSE', 'geminiService.regeneratePromptFromSummary SUCCESS', { sceneId: result.scene_id });
        return result;
    } catch (error) {
        console.error("Error regenerating prompt from summary:", error);
        throw error;
    }
};

export const generateScenePreview = async (prompt: ScenePrompt, allCharacters: Character[]): Promise<string> => {
    try {
        appLogger.add('API_REQUEST', 'geminiService.generateScenePreview', { model: 'gemini-2.5-flash-image', sceneId: prompt.scene_id });
        const ai = getGenAI();
        const parts: any[] = [];

        const sceneCharacters: Character[] = [];
        if (prompt.character_lock) {
            for (const charKey in prompt.character_lock) {
                const characterDetail = prompt.character_lock[charKey];
                if (characterDetail?.name) {
                    const foundChar = allCharacters.find(c => c.name === characterDetail.name);
                    if (foundChar) {
                        sceneCharacters.push(foundChar);
                    }
                }
            }
        }

        let characterReferenceText = '';
        if (sceneCharacters.length > 0) {
            characterReferenceText = sceneCharacters.map((char, index) => {
                parts.push({
                    inlineData: {
                        mimeType: char.imageMimeType || 'image/png',
                        data: char.image,
                    },
                });
                return `The character in image ${index + 1} is ${char.name}, who is described as: '${char.prompt}'.`;
            }).join(' ');
        }

        const characterAction = (prompt.character_lock && Object.values(prompt.character_lock).map(c => c?.description).filter(Boolean).join('. ')) || '';
        const environment = (prompt.background_lock && Object.values(prompt.background_lock)[0]?.description) || '';
        const sceneDescription = `A cinematic preview image. ${prompt.visual_style}. Scene featuring: ${characterAction}. In the environment: ${environment}.`;

        const finalTextPrompt = `${characterReferenceText} ${sceneDescription}`;
        parts.push({ text: finalTextPrompt });

        const response: GenerateContentResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: { parts },
            config: {
                responseModalities: [Modality.IMAGE],
            },
        });

        const candidate = response.candidates?.[0];
        if (!candidate) {
            appLogger.add('API_RESPONSE', 'geminiService.generateScenePreview FAILED', { response });
            throw new Error('No candidates returned from scene preview image API. Response logged.');
        }
        if (candidate.finishReason === 'SAFETY') {
            appLogger.add('API_RESPONSE', 'geminiService.generateScenePreview SAFETY_BLOCK', { response });
            throw new Error('Scene preview generation blocked by safety filters.');
        }
        const partsOut = candidate.content?.parts;
        if (!partsOut || !Array.isArray(partsOut) || partsOut.length === 0) {
            appLogger.add('API_RESPONSE', 'geminiService.generateScenePreview FAILED_NO_PARTS', { candidate });
            throw new Error('Scene preview response missing content parts. Response logged.');
        }
        for (const part of partsOut) {
            if (part?.inlineData) {
                appLogger.add('API_RESPONSE', 'geminiService.generateScenePreview SUCCESS', { sceneId: prompt.scene_id, imageReceived: true });
                return part.inlineData.data;
            }
        }
        appLogger.add('API_RESPONSE', 'geminiService.generateScenePreview FAILED_NO_INLINE', { candidate });
        throw new Error('Image data not found for scene preview (no inlineData in parts).');
    } catch (error) {
        console.error("Error generating scene preview:", error);
        throw error;
    }
};

export const generateImageSequenceForScene = async (prompt: ScenePrompt, sceneSummary: string, allCharacters: Character[]): Promise<string[]> => {
    appLogger.add('API_REQUEST', 'geminiService.generateImageSequenceForScene', { promptId: prompt.scene_id });
    const ai = getGenAI();
    const numFrames = 8;

    const mainAction = prompt.complete_prompt;

    const framePromptGenInstruction = `You are a film director creating a storyboard. Based on the following detailed scene description, break it down into exactly ${numFrames} distinct, sequential moments. For each moment, write a concise visual prompt suitable for an AI image generator. The prompts must describe a continuous action from one frame to the next. The final output must be a JSON object with a single key "frames", which is an array of ${numFrames} strings.

Scene Description: "${mainAction}"
Visual Style: "${prompt.visual_style}"`;

    const framePromptsResponse = await ai.models.generateContent({
        model: 'gemini-2.5-pro',
        contents: framePromptGenInstruction,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: { frames: { type: Type.ARRAY, items: { type: Type.STRING } } },
                required: ["frames"]
            }
        }
    });

    const { frames } = JSON.parse(framePromptsResponse.text);
    if (!frames || frames.length !== numFrames) {
        throw new Error(`Failed to generate the correct number of frame prompts. Expected ${numFrames}, got ${frames?.length || 0}.`);
    }
    appLogger.add('API_RESPONSE', 'geminiService.generateImageSequenceForScene (frame prompts) SUCCESS', { frameCount: frames.length });

    const sceneCharacters: Character[] = [];
    if (prompt.character_lock) {
        for (const charKey in prompt.character_lock) {
            const characterDetail = prompt.character_lock[charKey];
            if (characterDetail?.name) {
                const foundChar = allCharacters.find(c => c.name === characterDetail.name);
                if (foundChar) {
                    sceneCharacters.push(foundChar);
                }
            }
        }
    }

    const imagePromises = frames.map(async (framePrompt: string) => {
        const parts: any[] = [];
        let characterReferenceText = '';

        if (sceneCharacters.length > 0) {
            characterReferenceText = sceneCharacters.map((char, index) => {
                parts.push({
                    inlineData: { mimeType: char.imageMimeType || 'image/png', data: char.image }
                });
                return `The character in image ${index + 1} is ${char.name}, described as: '${char.prompt}'.`;
            }).join(' ');
        }
        
        const fullFramePrompt = `${characterReferenceText} A single frame from an animation in a ${prompt.visual_style} style: ${framePrompt}`;
        parts.push({ text: fullFramePrompt });

        const imageResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: { parts },
            config: { responseModalities: [Modality.IMAGE] }
        });

        const inlineData = imageResponse.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData;
        if (inlineData) {
            return inlineData.data;
        }
        throw new Error(`Image data not found for frame prompt: "${framePrompt}"`);
    });

    const results = await Promise.all(imagePromises);
    appLogger.add('API_RESPONSE', 'geminiService.generateImageSequenceForScene (images) SUCCESS', { imageCount: results.length });
    return results;
};

/**
 * Converts the detailed ScenePrompt JSON into a concise string for the video model.
 */
const synthesizeVideoPrompt = (prompt: ScenePrompt): string => {
    // The new ScenePrompt contains a "complete_prompt" field which is designed
    // to be the direct input for the video model.
    return prompt.complete_prompt;
};


export const startVideoGeneration = async (prompt: ScenePrompt, aspectRatio: AspectRatio, quality: VideoQuality, allCharacters: Character[]): Promise<any> => {
    try {
        // If the user has a VEO Flow session configured, prefer using Flow for generation
        try {
            let flowSession = null;
            if (typeof window !== 'undefined' && window.localStorage) {
                flowSession = window.localStorage.getItem('VEO_FLOW_SESSION');
            }
            const flowBase = (typeof window !== 'undefined' && window.localStorage) ? window.localStorage.getItem('VEO_FLOW_BASE') : null;
            if (flowSession) {
                const flowRes = await flowService.generateVideoFromFlow(prompt.complete_prompt || prompt.visual_style || '', {
                    sessionKey: flowSession,
                    baseUrl: flowBase || undefined,
                    headerName: (typeof window !== 'undefined' && window.localStorage?.getItem('VEO_FLOW_HEADER')) || 'Authorization',
                    headerPrefix: (typeof window !== 'undefined' && window.localStorage?.getItem('VEO_FLOW_PREFIX')) || 'Bearer ',
                    cookieName: (typeof window !== 'undefined' && window.localStorage?.getItem('VEO_FLOW_COOKIE')) || undefined,
                    timeoutMs: 2 * 60 * 1000,
                });
                if (flowRes.success && flowRes.url) {
                    // Return an operation-like object that the renderer can handle specially
                    return { __flow: true, done: true, response: { generatedVideos: [{ video: { uri: flowRes.url } }] } };
                } else {
                    appLogger.add('ERROR', 'flowService.generateVideoFromFlow failed', { message: flowRes.message });
                }
            }
        } catch (e) {
            appLogger.add('ERROR', 'flowService invocation error', { error: String(e) });
        }
        const ai = getGenAI();
        
        const config: any = {
            numberOfVideos: 1,
            resolution: quality === 'high' ? '1080p' : '720p',
            aspectRatio: aspectRatio,
        };

        let synthesizedPrompt = synthesizeVideoPrompt(prompt);
        let modelName = 'veo-3.1-fast-generate-preview'; // Default to fast

        if (quality === 'high') {
            modelName = 'veo-3.1-generate-preview';
        } else if (quality === 'flow') {
            modelName = 'veo-3.1-fast-generate-preview';
            config.resolution = '720p';
            synthesizedPrompt = `Generate this video in the highly cinematic, artistic, and fluid style of Google's Flow tool. Focus on smooth camera movements, creative visual transitions, and a dreamlike quality. Scene: ${synthesizedPrompt}`;
        }
        
        const payload: any = { model: modelName, config: config };
        
        const sceneCharacters: Character[] = [];
        if (prompt.character_lock) {
            for (const charKey in prompt.character_lock) {
                const characterDetail = prompt.character_lock[charKey];
                if (characterDetail?.name) {
                    const foundChar = allCharacters.find(c => c.name === characterDetail.name);
                    if (foundChar) {
                        sceneCharacters.push(foundChar);
                    }
                }
            }
        }
        
        const primaryCharacter = sceneCharacters[0];

        if (primaryCharacter?.image) {
            payload.image = { imageBytes: primaryCharacter.image, mimeType: primaryCharacter.imageMimeType || 'image/png' };
            
            const allCharacterDescriptions = sceneCharacters.map(c => 
                `${c.name} is described as: '${c.prompt}'`
            ).join('. ');

            const baseInstruction = `CRITICAL INSTRUCTION: The provided image is a character sheet for ${primaryCharacter.name} for visual reference ONLY. IGNORE the character's pose and the solid white background. Render the character as described in the scene prompt below, placing them directly into the specified environment and action.
            
            Full character descriptions for this scene: ${allCharacterDescriptions}.`;
            
            synthesizedPrompt = `${baseInstruction}\n\nScene Prompt: ${synthesizedPrompt}`;
        }

        payload.prompt = synthesizedPrompt;

        appLogger.add('API_REQUEST', 'geminiService.startVideoGeneration', { payload: { model: payload.model, config: payload.config, prompt: payload.prompt } });
        const operation = await ai.models.generateVideos(payload);
        appLogger.add('API_RESPONSE', 'geminiService.startVideoGeneration STARTED', { operation });
        return operation;
    } catch (error) {
        console.error("Error starting video generation:", error);
        throw error;
    }
};

export const checkVideoOperationStatus = async (operation: any): Promise<any> => {
    try {
        // No need to log this as it's a polling request, would spam the logs.
        const ai = getGenAI();
        const updatedOperation = await ai.operations.getVideosOperation({ operation: operation });
        return updatedOperation;
    } catch (error) {
        console.error("Error checking video operation status:", error);
        throw error;
    }
};

export const fetchVideoData = async (uri: string): Promise<string> => {
    try {
        const apiKey = resolveApiKey();
        if (!apiKey) {
            throw new Error("API key not provided. Please set GEMINI_API_KEY in localStorage or provide process.env.API_KEY.");
        }
        appLogger.add('API_REQUEST', 'geminiService.fetchVideoData', { uri: uri.split('&key=')[0] });
        const response = await fetch(`${uri}&key=${apiKey}`);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to fetch video data: ${response.status} ${response.statusText} - ${errorText}`);
        }
        const blob = await response.blob();
        appLogger.add('API_RESPONSE', 'geminiService.fetchVideoData SUCCESS', { blobSize: blob.size, blobType: blob.type });
        return URL.createObjectURL(blob);
    } catch (error) {
        console.error("Error fetching video data:", error);
        throw error;
    }
};

export const generateFinalMeta = async (scenePrompts: ScenePrompt[], story: string, musicStyle: string): Promise<Omit<FinalVideoMeta, 'thumbnail'>> => {
    const promptSummaries = scenePrompts.map((p, i) => {
       const summary = p.complete_prompt.substring(0, 150); // Get a snippet
       return `- Scene ${i + 1} summary: ${summary}...`;
    }).join('\n');

    const prompt = `
    You are an expert in social media marketing for short-form video content.
    Based on the provided story, scene descriptions, and music style, generate metadata for a YouTube Short or TikTok video.

    **Story:**
    ${story}

    **Scene Descriptions:**
    ${promptSummaries}

    **Music Style:**
    ${musicStyle}

    **Instructions:**
    1.  **Title:** Create a short, catchy, and SEO-friendly title (under 70 characters).
    2.  **Description:** Write a compelling description (2-3 sentences) that summarizes the video and includes relevant keywords.
    3.  **Hashtags:** Provide a list of 5-7 relevant and trending hashtags.

    Return the result as a single JSON object.
    `;

    try {
        appLogger.add('API_REQUEST', 'geminiService.generateFinalMeta', { model: 'gemini-2.5-pro', storyLength: story.length });
        const ai = getGenAI();
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-pro',
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        title: { type: Type.STRING },
                        description: { type: Type.STRING },
                        hashtags: {
                            type: Type.ARRAY,
                            items: { type: Type.STRING }
                        }
                    },
                    required: ["title", "description", "hashtags"]
                }
            }
        });
        const result = JSON.parse(response.text);
        appLogger.add('API_RESPONSE', 'geminiService.generateFinalMeta SUCCESS', { result });
        return result;
    } catch (error) {
        console.error("Error generating final metadata:", error);
        throw error;
    }
};

export const generateThumbnail = async (videoTitle: string, storySummary: string): Promise<string> => {
    const prompt = `Create a visually stunning and compelling thumbnail image for a short video. The thumbnail should be eye-catching and represent the core themes of the story. It should not contain any text.
    
    Video Title: "${videoTitle}"
    Story Summary: "${storySummary}"
    
    Style: cinematic, high contrast, vibrant colors, dramatic lighting.`;

    try {
        appLogger.add('API_REQUEST', 'geminiService.generateThumbnail', { model: 'imagen-4.0-generate-001', videoTitle });
        const ai = getGenAI();
        const response = await ai.models.generateImages({
            model: 'imagen-4.0-generate-001',
            prompt: prompt,
            config: {
                numberOfImages: 1,
                outputMimeType: 'image/jpeg',
                aspectRatio: '9:16', // For shorts/reels
            },
        });

        const base64ImageBytes: string = response.generatedImages[0].image.imageBytes;
        if (!base64ImageBytes) {
            throw new Error("Thumbnail image data not found in API response.");
        }
        appLogger.add('API_RESPONSE', 'geminiService.generateThumbnail SUCCESS', { imageReceived: true });
        return base64ImageBytes;
    } catch (error) {
        console.error("Error generating thumbnail:", error);
        throw error;
    }
};

export const generateEvolutionPrompts = async (asset: EvolvingAsset, numStages: number): Promise<string[]> => {
  const prompt = `
  You are a visual storyteller and concept artist. Your task is to describe the visual evolution of an object or creature over a series of stages.

  **Asset Name:** ${asset.name}
  **Asset Type:** ${asset.type}

  **Starting State:**
  "${asset.initialPrompt}"

  **Final State:**
  "${asset.finalPrompt}"

  **Number of Stages:** ${numStages}

  **Instructions:**
  Create a list of exactly ${numStages} descriptive prompts. Each prompt corresponds to one stage of the evolution.
  The first prompt should be very similar to the "Starting State".
  The last prompt should be very similar to the "Final State".
  The prompts in between must show a clear, logical, and gradual visual progression from the start to the end.
  Each prompt should be a concise, descriptive sentence suitable for an AI image or video generator.

  Return the result as a single JSON object with a single key "prompts", which is an array of strings.
  `;
  appLogger.add('API_REQUEST', 'geminiService.generateEvolutionPrompts', { model: 'gemini-2.5-pro', asset, numStages });
  const ai = getGenAI();
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-pro',
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          prompts: {
            type: Type.ARRAY,
            items: {
              type: Type.STRING
            }
          }
        },
        required: ["prompts"]
      }
    }
  });

  const result = JSON.parse(response.text);
  if (!result.prompts || !Array.isArray(result.prompts) || result.prompts.length !== numStages) {
    throw new Error(`Failed to generate the correct number of evolution prompts. Expected ${numStages}.`);
  }
  appLogger.add('API_RESPONSE', 'geminiService.generateEvolutionPrompts SUCCESS', { promptCount: result.prompts.length });
  return result.prompts;
}