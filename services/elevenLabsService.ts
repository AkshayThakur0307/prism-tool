
const ELEVENLABS_API_KEY = import.meta.env.VITE_ELEVENLABS_API_KEY || process.env.VITE_ELEVENLABS_API_KEY;

export const ElevenLabsService = {
    /**
     * Streams text to speech using ElevenLabs API and plays the audio.
     * @param text The text to convert to speech.
     * @param voiceId The ID of the voice to use.
     * @returns A promise that resolves when the audio starts playing (or finishes fetching).
     */
    async speak(text: string, voiceId: string): Promise<void> {
        console.log(`[ElevenLabs] Attempting to speak: "${text.substring(0, 20)}..." with Voice ID: ${voiceId}`);

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
            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

            console.log("[ElevenLabs] Audio decoded. Playing...");
            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContext.destination);
            source.start(0);

            return new Promise((resolve) => {
                source.onended = () => {
                    console.log("[ElevenLabs] Audio playback finished.");
                    resolve();
                };
                setTimeout(resolve, audioBuffer.duration * 1000);
            });

        } catch (error) {
            console.error("[ElevenLabs] Critical Error:", error);
            // Fallback
            const utterance = new SpeechSynthesisUtterance(text);
            window.speechSynthesis.speak(utterance);
        }
    }
};
