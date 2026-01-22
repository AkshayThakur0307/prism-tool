
const ELEVENLABS_API_KEY = import.meta.env.VITE_ELEVENLABS_API_KEY || process.env.VITE_ELEVENLABS_API_KEY;

let currentAudioContext: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;

export const ElevenLabsService = {
    /**
     * Streams text to speech using ElevenLabs API and plays the audio.
     * @param text The text to convert to speech.
     * @param voiceId The ID of the voice to use.
     * @returns A promise that resolves when the audio starts playing (or finishes fetching).
     */
    async speak(text: string, voiceId: string): Promise<void> {
        console.log(`[ElevenLabs] Attempting to speak: "${text.substring(0, 20)}..." with Voice ID: ${voiceId}`);

        // Stop any existing audio first
        this.stop();

        // Re-check key at runtime to be sure
        const runtimeKey = import.meta.env.VITE_ELEVENLABS_API_KEY || process.env.VITE_ELEVENLABS_API_KEY || ELEVENLABS_API_KEY;

        if (!runtimeKey) {
            console.warn("[ElevenLabs] API Key is MISSING. Falling back to browser TTS.");
            const utterance = new SpeechSynthesisUtterance(text);
            window.speechSynthesis.speak(utterance);
            return;
        }

        try {
            console.log("[ElevenLabs] Fetching audio stream...");
            const response = await fetch(
                `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
                {
                    method: 'POST',
                    headers: {
                        'Accept': 'audio/mpeg',
                        'Content-Type': 'application/json',
                        'xi-api-key': runtimeKey,
                    },
                    body: JSON.stringify({
                        text,
                        model_id: "eleven_multilingual_v2", // Updated: v1 is deprecated on free tier
                        voice_settings: {
                            stability: 0.5,
                            similarity_boost: 0.75,
                        }
                    }),
                }
            );

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[ElevenLabs] API Error: ${response.status} ${response.statusText}`, errorText);
                throw new Error(`ElevenLabs API Error: ${response.statusText} - ${errorText}`);
            }

            console.log("[ElevenLabs] Audio stream received. Decoding...");
            const arrayBuffer = await response.arrayBuffer();

            // Create context if needed
            if (!currentAudioContext) {
                currentAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            } else if (currentAudioContext.state === 'suspended') {
                await currentAudioContext.resume();
            }

            const audioBuffer = await currentAudioContext.decodeAudioData(arrayBuffer);

            console.log("[ElevenLabs] Audio decoded. Playing...");
            currentSource = currentAudioContext.createBufferSource();
            currentSource.buffer = audioBuffer;
            currentSource.connect(currentAudioContext.destination);
            currentSource.start(0);

            return new Promise((resolve) => {
                if (currentSource) {
                    currentSource.onended = () => {
                        console.log("[ElevenLabs] Audio playback finished.");
                        currentSource = null;
                        resolve();
                    };
                } else {
                    resolve();
                }
            });

        } catch (error) {
            console.error("[ElevenLabs] Critical Error:", error);
            // Fallback
            const utterance = new SpeechSynthesisUtterance(text);
            window.speechSynthesis.speak(utterance);
        }
    },

    /**
     * Immediately stops any currently playing audio.
     */
    stop() {
        if (currentSource) {
            try {
                currentSource.stop();
                console.log("[ElevenLabs] Audio source stopped manually.");
            } catch (e) {
                // Ignore if already stopped
            }
            currentSource = null;
        }

        // Also cancel browser TTS just in case
        if (window.speechSynthesis) {
            window.speechSynthesis.cancel();
        }
    }
};
