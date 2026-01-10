
import { GoogleGenAI, Modality, Type, LiveServerMessage } from '@google/genai';

export interface LiveHandlers {
  onUpdateMainContext: (text: string, mode: 'replace' | 'append') => void;
  onUpdateRefinementAnswer: (index: number, text: string) => void;
  onSwitchModule: (module: string) => void;
  onTranscription: (text: string, role: 'user' | 'model') => void;
  onStateChange: (state: { isListening: boolean; isSpeaking: boolean }) => void;
  onError?: (error: any) => void;
}

import { GEMINI_MODELS } from './modelConfig';

export function createLiveAssistant(handlers: LiveHandlers, currentQuestions: string[] = [], currentMainInput: string = "") {
  // Define API Client - checking multiple common env var patterns for client-side compatibility
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY ||
    import.meta.env.VITE_API_KEY ||
    process.env.API_KEY ||
    process.env.NEXT_PUBLIC_GEMINI_API_KEY ||
    process.env.NEXT_PUBLIC_API_KEY;

  if (!apiKey) {
    console.error("Gemini API Key is missing for Live Service!");
  }

  const ai = new GoogleGenAI({ apiKey: apiKey || '' });
  let nextStartTime = 0;
  let inputAudioContext: AudioContext | null = null;
  let outputAudioContext: AudioContext | null = null;
  let audioSources = new Set<AudioBufferSourceNode>();
  let stream: MediaStream | null = null;

  const decodeBase64 = (base64: string) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  };

  const encodeBase64 = (bytes: Uint8Array) => {
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  };

  const decodeAudio = async (data: Uint8Array, ctx: AudioContext) => {
    const dataInt16 = new Int16Array(data.buffer);
    const buffer = ctx.createBuffer(1, dataInt16.length, 24000);
    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < dataInt16.length; i++) channelData[i] = dataInt16[i] / 32768.0;
    return buffer;
  };

  const createPCMData = (data: Float32Array) => {
    const int16 = new Int16Array(data.length);
    for (let i = 0; i < data.length; i++) int16[i] = data[i] * 32768;
    return {
      data: encodeBase64(new Uint8Array(int16.buffer)),
      mimeType: 'audio/pcm;rate=16000',
    };
  };

  const tools = [
    {
      name: 'updateMainContext',
      parameters: {
        type: Type.OBJECT,
        properties: {
          text: { type: Type.STRING, description: 'The text to add or set in the main context field.' },
          mode: { type: Type.STRING, enum: ['replace', 'append'], description: 'Whether to replace existing text or append to it.' }
        },
        required: ['text', 'mode']
      },
      description: 'Update the main project context/input field for the current module.'
    },
    {
      name: 'updateRefinementAnswer',
      parameters: {
        type: Type.OBJECT,
        properties: {
          index: { type: Type.NUMBER, description: 'The zero-based index of the refinement question being answered.' },
          text: { type: Type.STRING, description: 'The answer text to provide for this specific question.' }
        },
        required: ['index', 'text']
      },
      description: 'Answer one of the specific follow-up/refinement questions.'
    },
    {
      name: 'switchModule',
      parameters: {
        type: Type.OBJECT,
        properties: {
          module: { type: Type.STRING, enum: ['DOMAIN', 'BOD', 'KPI', 'EPICS'], description: 'The module ID to switch to.' }
        },
        required: ['module']
      },
      description: 'Switch the application to a different discovery stage/module.'
    }
  ];

  const questionsContext = currentQuestions.length > 0
    ? `The current refinement questions available for this module are:\n${currentQuestions.map((q, i) => `${i}: ${q}`).join('\n')}`
    : "There are currently no refinement questions for this stage.";

  const systemInstruction = `You are the PRSIM.AI Material + Discovery Assistant. 
You help users complete product discovery modules.
Current Main Input: "${currentMainInput}"
${questionsContext}

CRITICAL INSTRUCTIONS:
1. Listen to the user's input and decide if they are providing general project information or answering a specific refinement question.
2. If it's general info or a new project detail, use 'updateMainContext'.
3. If they are answering one of the ${currentQuestions.length} specific questions listed above, identify the index (0 to ${currentQuestions.length - 1}) and use 'updateRefinementAnswer'.
4. If they want to move to another part of the process, use 'switchModule'.
5. Be concise and conversational. Confirm what you have updated.`;

  let isConnected = false;

  const safeSend = (session: any, data: any) => {
    if (!isConnected) return;
    try {
      session.sendRealtimeInput(data);
    } catch (e) {
      console.warn("Socket send failed", e);
      isConnected = false;
    }
  };

  const sessionPromise = ai.live.connect({
    model: GEMINI_MODELS.FLASH_EXP,
    config: {
      responseModalities: [Modality.AUDIO],
      tools: [{ functionDeclarations: tools }],
      systemInstruction: systemInstruction,
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
      inputAudioTranscription: {},
      outputAudioTranscription: {}
    },
    callbacks: {
      onopen: () => {
        isConnected = true;
        handlers.onStateChange({ isListening: true, isSpeaking: false });
        navigator.mediaDevices.getUserMedia({ audio: true }).then(s => {
          stream = s;
          inputAudioContext = new AudioContext({ sampleRate: 16000 });
          const source = inputAudioContext.createMediaStreamSource(s);
          const processor = inputAudioContext.createScriptProcessor(4096, 1, 1);
          processor.onaudioprocess = (e) => {
            if (!isConnected) return;
            const pcm = createPCMData(e.inputBuffer.getChannelData(0));
            sessionPromise.then(session => safeSend(session, { media: pcm }));
          };
          source.connect(processor);
          processor.connect(inputAudioContext.destination);
        });
      },
      onmessage: async (msg: LiveServerMessage) => {
        if (msg.serverContent?.inputTranscription) {
          handlers.onTranscription(msg.serverContent.inputTranscription.text, 'user');
        }
        if (msg.serverContent?.outputTranscription) {
          handlers.onTranscription(msg.serverContent.outputTranscription.text, 'model');
        }

        if (msg.toolCall) {
          for (const fc of msg.toolCall.functionCalls) {
            let result = 'ok';
            if (fc.name === 'updateMainContext') handlers.onUpdateMainContext(fc.args.text as string, fc.args.mode as any);
            if (fc.name === 'updateRefinementAnswer') handlers.onUpdateRefinementAnswer(fc.args.index as number, fc.args.text as string);
            if (fc.name === 'switchModule') handlers.onSwitchModule(fc.args.module as string);

            sessionPromise.then(s => s.sendToolResponse({
              functionResponses: { id: fc.id, name: fc.name, response: { result } }
            }));
          }
        }

        const audioData = msg.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
        if (audioData) {
          if (!outputAudioContext) outputAudioContext = new AudioContext({ sampleRate: 24000 });
          handlers.onStateChange({ isListening: true, isSpeaking: true });
          const buffer = await decodeAudio(decodeBase64(audioData), outputAudioContext);
          const source = outputAudioContext.createBufferSource();
          source.buffer = buffer;
          source.connect(outputAudioContext.destination);
          nextStartTime = Math.max(nextStartTime, outputAudioContext.currentTime);
          source.start(nextStartTime);
          nextStartTime += buffer.duration;
          source.onended = () => {
            audioSources.delete(source);
            if (audioSources.size === 0) handlers.onStateChange({ isListening: true, isSpeaking: false });
          };
          audioSources.add(source);
        }

        if (msg.serverContent?.interrupted) {
          audioSources.forEach(s => s.stop());
          audioSources.clear();
          nextStartTime = 0;
        }
      },
      onclose: () => {
        isConnected = false;
        stream?.getTracks().forEach(t => t.stop());
        inputAudioContext?.close();
        outputAudioContext?.close();
      },
      onerror: (e) => {
        console.error('Live API Error:', e);
        if (handlers.onError) handlers.onError(e);
      }
    }
  });

  return {
    stop: () => sessionPromise.then(s => s.close())
  };
}
