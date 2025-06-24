import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Mic, 
  MicOff, 
  Volume2, 
  VolumeX, 
  Play, 
  Pause, 
  Square, 
  MessageCircle,
  Clock,
  FileText,
  Send,
  Loader,
  Wifi,
  WifiOff,
  AlertCircle,
  Phone,
  PhoneOff,
  Users,
  Signal,
  StopCircle,
  Settings,
  Brain,
  Zap,
  CheckCircle,
  XCircle
} from 'lucide-react';
import { InterviewConfig } from '../types';
import { AIInterviewSimulator } from '../utils/aiSimulator';
import { useLiveKit } from '../hooks/useLiveKit';
import { VoiceInterviewService } from '../services/voiceInterviewService';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';

interface VoiceInterviewScreenProps {
  config: InterviewConfig;
  onEndInterview: (simulator: AIInterviewSimulator) => void;
  onBackToConfig: () => void;
}

export const VoiceInterviewScreen: React.FC<VoiceInterviewScreenProps> = ({
  config,
  onEndInterview,
  onBackToConfig
}) => {
  const [simulator] = useState(() => new AIInterviewSimulator(config));
  const [isInterviewActive, setIsInterviewActive] = useState(false);
  const [notes, setNotes] = useState('');
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isThinking, setIsThinking] = useState(false);
  const [voiceSession, setVoiceSession] = useState<any>(null);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [audioLevel, setAudioLevel] = useState(0);
  const [participantName] = useState(`participant-${Date.now()}`);
  const [livekitReady, setLivekitReady] = useState(false);
  const [showEndConfirmation, setShowEndConfirmation] = useState(false);
  const [conversationHistory, setConversationHistory] = useState<any[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<string>('');
  const [isAISpeaking, setIsAISpeaking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [aiAgentStatus, setAiAgentStatus] = useState<any>(null);
  const [selectedProvider, setSelectedProvider] = useState<'openai' | 'google'>('google');
  const [showProviderSelection, setShowProviderSelection] = useState(false);
  const [showAutoplayPrompt, setShowAutoplayPrompt] = useState(false);
  const [audioTestResult, setAudioTestResult] = useState<'none' | 'success' | 'failed'>('none');
  
  // Audio management refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const speechSynthesisRef = useRef<SpeechSynthesis | null>(null);
  
  // Refs for stable event handlers
  const isInterviewActiveRef = useRef(isInterviewActive);
  const isListeningRef = useRef(false);
  const startListeningRef = useRef<(() => void) | null>(null);
  const stopListeningRef = useRef<(() => void) | null>(null);
  const setUserSpeakingRef = useRef(setUserSpeaking);
  const setIsAISpeakingRef = useRef(setIsAISpeaking);
  const setShowAutoplayPromptRef = useRef(setShowAutoplayPrompt);
  
  const {
    isListening,
    transcript,
    startListening,
    stopListening,
    resetTranscript,
    isSupported: speechSupported
  } = useSpeechRecognition();

  // Handle data messages from AI agent
  const handleDataMessage = useCallback((data: any) => {
    console.log('[VoiceInterview] 📨 Received data message:', data);
    
    if (data.type === 'question' && data.text) {
      setCurrentQuestion(data.text);
      setConversationHistory(prev => [...prev, {
        speaker: 'ai',
        message: data.text,
        timestamp: Date.now(),
        type: 'question'
      }]);
    } else if (data.type === 'greeting' && data.text) {
      setCurrentQuestion(data.text);
      setConversationHistory(prev => [...prev, {
        speaker: 'ai',
        message: data.text,
        timestamp: Date.now(),
        type: 'greeting'
      }]);
    } else if (data.type === 'feedback' && data.text) {
      setConversationHistory(prev => [...prev, {
        speaker: 'ai',
        message: data.text,
        timestamp: Date.now(),
        type: 'feedback'
      }]);
    }
  }, []);

  // Create LiveKit props using the backend-provided URL when we have a session
  const livekitProps = voiceSession && voiceSession.participantToken ? {
    wsUrl: voiceSession.wsUrl,
    token: voiceSession.participantToken,
    onConnected: () => {
      setConnectionStatus('connected');
      console.log('[VoiceInterview] ✅ Connected to LiveKit room');
    },
    onDisconnected: () => {
      setConnectionStatus('disconnected');
      console.log('[VoiceInterview] ❌ Disconnected from LiveKit room');
    },
    onError: (error: Error) => {
      setConnectionStatus('error');
      console.error('[VoiceInterview] ❌ LiveKit error:', error);
    },
    onDataMessageReceived: handleDataMessage
  } : null;

  // Only initialize LiveKit hook when we have valid props
  const {
    room,
    isConnected: livekitConnected,
    isConnecting: livekitConnecting,
    error: livekitError,
    localAudioTrack,
    remoteAudioTracks,
    connect: connectLiveKit,
    disconnect: disconnectLiveKit,
    startAudio,
    stopAudio,
    sendDataMessage
  } = useLiveKit(livekitProps || {
    wsUrl: '',
    token: '',
    onConnected: () => {},
    onDisconnected: () => {},
    onError: () => {},
    onDataMessageReceived: () => {}
  });

  const notesRef = useRef<HTMLTextAreaElement>(null);

  // Update refs when state/callbacks change
  useEffect(() => {
    isInterviewActiveRef.current = isInterviewActive;
  }, [isInterviewActive]);

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  useEffect(() => {
    startListeningRef.current = startListening;
  }, [startListening]);

  useEffect(() => {
    stopListeningRef.current = stopListening;
  }, [stopListening]);

  useEffect(() => {
    setUserSpeakingRef.current = setUserSpeaking;
  }, []);

  useEffect(() => {
    setIsAISpeakingRef.current = setIsAISpeaking;
  }, []);

  useEffect(() => {
    setShowAutoplayPromptRef.current = setShowAutoplayPrompt;
  }, []);

  // Initialize audio context and speech synthesis
  useEffect(() => {
    const initializeAudio = async () => {
      try {
        // Initialize AudioContext for better audio control
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
          console.log('🎵 AudioContext initialized');
        }

        // Initialize Speech Synthesis for fallback TTS
        if ('speechSynthesis' in window) {
          speechSynthesisRef.current = window.speechSynthesis;
          console.log('🗣️ Speech Synthesis initialized');
        }

      } catch (error) {
        console.error('❌ Error initializing audio:', error);
      }
    };

    initializeAudio();

    return () => {
      // Cleanup audio elements
      audioElementsRef.current.forEach(audio => {
        audio.pause();
        audio.remove();
      });
      audioElementsRef.current.clear();

      // Close audio context
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
    };
  }, []);

  // Timer effect
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isInterviewActive && startTime) {
      interval = setInterval(() => {
        setElapsedTime(Date.now() - startTime);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isInterviewActive, startTime]);

  // Enhanced remote audio track handling with stable dependencies
  useEffect(() => {
    if (remoteAudioTracks.length > 0) {
      console.log(`🎵 Processing ${remoteAudioTracks.length} remote audio tracks`);
      
      remoteAudioTracks.forEach((track, index) => {
        const trackId = track.sid || `track-${index}`;
        
        // Check if we already have an audio element for this track
        if (!audioElementsRef.current.has(trackId)) {
          console.log(`🎵 Creating new audio element for track: ${trackId}`);
          
          // Create audio element
          const audioElement = document.createElement('audio');
          audioElement.autoplay = true;
          audioElement.playsInline = true;
          audioElement.volume = 1.0;
          
          // Set up event listeners using refs for stable dependencies
          audioElement.onplay = () => {
            console.log(`🎵 Audio started playing for track: ${trackId}`);
            setIsAISpeakingRef.current(true);
            setUserSpeakingRef.current(false);
            setShowAutoplayPromptRef.current(false);
            // Stop user listening when AI starts speaking
            if (isListeningRef.current && stopListeningRef.current) {
              stopListeningRef.current();
            }
          };
          
          audioElement.onended = () => {
            console.log(`🎵 Audio ended for track: ${trackId}`);
            setIsAISpeakingRef.current(false);
            // Resume listening after AI finishes speaking
            setTimeout(() => {
              if (isInterviewActiveRef.current && !isListeningRef.current && startListeningRef.current) {
                startListeningRef.current();
                setUserSpeakingRef.current(false);
              }
            }, 500);
          };
          
          audioElement.onpause = () => {
            console.log(`🎵 Audio paused for track: ${trackId}`);
            setIsAISpeakingRef.current(false);
          };
          
          audioElement.onerror = (error) => {
            console.error(`❌ Audio error for track ${trackId}:`, error);
            setIsAISpeakingRef.current(false);
          };
          
          audioElement.onloadstart = () => {
            console.log(`🎵 Audio loading started for track: ${trackId}`);
          };
          
          audioElement.oncanplay = () => {
            console.log(`🎵 Audio can play for track: ${trackId}`);
          };
          
          // Attach the track to the audio element
          try {
            track.attach(audioElement);
            console.log(`🎵 Track attached to audio element: ${trackId}`);
            
            // Add to DOM (hidden)
            audioElement.style.display = 'none';
            document.body.appendChild(audioElement);
            
            // Store reference
            audioElementsRef.current.set(trackId, audioElement);
            
            // Force play if needed (handle autoplay restrictions)
            const playPromise = audioElement.play();
            if (playPromise) {
              playPromise
                .then(() => {
                  console.log(`✅ Audio autoplay successful for track: ${trackId}`);
                  setShowAutoplayPromptRef.current(false);
                })
                .catch(error => {
                  console.warn(`⚠️ Autoplay prevented for track ${trackId}:`, error);
                  if (error.name === 'NotAllowedError') {
                    setShowAutoplayPromptRef.current(true);
                  }
                });
            }
            
          } catch (attachError) {
            console.error(`❌ Error attaching track ${trackId}:`, attachError);
          }
        }
      });
    }

    // Cleanup removed tracks
    const currentTrackIds = new Set(remoteAudioTracks.map((track, index) => track.sid || `track-${index}`));
    audioElementsRef.current.forEach((audioElement, trackId) => {
      if (!currentTrackIds.has(trackId)) {
        console.log(`🗑️ Cleaning up audio element for removed track: ${trackId}`);
        audioElement.pause();
        audioElement.remove();
        audioElementsRef.current.delete(trackId);
      }
    });

  }, [remoteAudioTracks]); // Only depend on remoteAudioTracks

  // Audio level monitoring
  useEffect(() => {
    if (localAudioTrack) {
      const analyzeAudio = () => {
        setAudioLevel(Math.random() * 100);
      };
      
      const interval = setInterval(analyzeAudio, 100);
      return () => clearInterval(interval);
    }
  }, [localAudioTrack]);

  // Update connection status based on LiveKit state
  useEffect(() => {
    if (!livekitProps) {
      return;
    }
    
    if (livekitConnecting) {
      setConnectionStatus('connecting');
    } else if (livekitConnected) {
      setConnectionStatus('connected');
    } else if (livekitError) {
      setConnectionStatus('error');
    } else if (voiceSession) {
      setConnectionStatus('disconnected');
    }
  }, [livekitConnecting, livekitConnected, livekitError, voiceSession, livekitProps]);

  // Effect to handle LiveKit connection after session is set
  useEffect(() => {
    if (voiceSession && voiceSession.participantToken && !livekitReady) {
      console.log('[VoiceInterview] Session ready, preparing LiveKit connection');
      setLivekitReady(true);
      
      setTimeout(async () => {
        try {
          console.log('[VoiceInterview] ========== ATTEMPTING LIVEKIT CONNECTION ==========');
          
          await connectLiveKit();
          
          setIsInterviewActive(true);
          setStartTime(Date.now());
          setIsThinking(false);
          
          // REMOVED: The premature startListening call that was causing the issue
          // The listening will now be triggered properly when the AI finishes speaking
          // via the audioElement.onended event handler above
          
          console.log('[VoiceInterview] ✅ Voice interview started successfully');
        } catch (connectError) {
          console.error('[VoiceInterview] ❌ Failed to connect to LiveKit:', connectError);
          setConnectionStatus('error');
          setIsThinking(false);
          alert(`Failed to connect to voice interview: ${connectError instanceof Error ? connectError.message : 'Unknown error'}`);
        }
      }, 200);
    }
  }, [voiceSession, livekitReady, connectLiveKit]);

  // Handle transcript changes
  useEffect(() => {
    if (transcript && transcript.trim().length > 0) {
      setUserSpeaking(true);
      
      // Add user speech to conversation history
      const lastEntry = conversationHistory[conversationHistory.length - 1];
      if (!lastEntry || lastEntry.speaker !== 'user' || lastEntry.type !== 'speaking') {
        setConversationHistory(prev => [...prev, {
          speaker: 'user',
          message: transcript,
          timestamp: Date.now(),
          type: 'speaking'
        }]);
      } else {
        // Update the last user entry
        setConversationHistory(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            message: transcript,
            timestamp: Date.now()
          };
          return updated;
        });
      }
    }
  }, [transcript, conversationHistory]);

  // Enable audio function for autoplay prompt
  const enableAudio = () => {
    audioElementsRef.current.forEach(audioElement => {
      audioElement.play().catch(error => {
        console.error('Failed to enable audio:', error);
      });
    });
    setShowAutoplayPrompt(false);
  };

  // Fallback Text-to-Speech function
  const speakTextFallback = (text: string) => {
    if (speechSynthesisRef.current) {
      // Cancel any ongoing speech
      speechSynthesisRef.current.cancel();
      
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.9;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;
      
      // Try to use a female voice
      const voices = speechSynthesisRef.current.getVoices();
      const femaleVoice = voices.find(voice => 
        voice.name.toLowerCase().includes('female') || 
        voice.name.toLowerCase().includes('woman') ||
        voice.name.toLowerCase().includes('samantha') ||
        voice.name.toLowerCase().includes('karen')
      );
      
      if (femaleVoice) {
        utterance.voice = femaleVoice;
      }
      
      utterance.onstart = () => {
        console.log('🗣️ Fallback TTS started');
        setIsAISpeaking(true);
        setAudioTestResult('success');
        if (isListening) {
          stopListening();
        }
      };
      
      utterance.onend = () => {
        console.log('🗣️ Fallback TTS ended');
        setIsAISpeaking(false);
        setTimeout(() => {
          if (isInterviewActive && !isListening) {
            startListening();
          }
        }, 500);
      };
      
      utterance.onerror = (error) => {
        console.error('❌ Fallback TTS error:', error);
        setIsAISpeaking(false);
        setAudioTestResult('failed');
      };
      
      speechSynthesisRef.current.speak(utterance);
      console.log('🗣️ Speaking with fallback TTS:', text.substring(0, 50) + '...');
    }
  };

  const formatTime = (ms: number): string => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const startVoiceInterview = async () => {
    try {
      setIsThinking(true);
      setConnectionStatus('connecting');
      setShowProviderSelection(false);
      
      console.log('[VoiceInterview] ========== STARTING VOICE INTERVIEW ==========');
      console.log('[VoiceInterview] Selected provider:', selectedProvider);
      
      // Start voice interview session with selected provider
      const session = await VoiceInterviewService.startVoiceInterview(
        config, 
        participantName, 
        true, // enableAIAgent
        selectedProvider // agentProvider
      );
      
      console.log('[VoiceInterview] Session received from backend:', session);
      
      if (!session.participantToken) {
        throw new Error('No participant token received from backend');
      }
      
      // Set the session
      setVoiceSession(session);
      setAiAgentStatus({
        enabled: session.aiAgentEnabled,
        provider: session.agentProvider,
        conversational: session.conversationalMode
      });
      
      // Clear conversation history - it will be populated by data messages
      setConversationHistory([]);
      setCurrentQuestion('');
      
    } catch (error) {
      console.error('[VoiceInterview] ❌ Error starting voice interview:', error);
      setConnectionStatus('error');
      setIsThinking(false);
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      alert(`Failed to start voice interview: ${errorMessage}`);
    }
  };

  const pauseInterview = async () => {
    setIsInterviewActive(false);
    stopListening();
    if (livekitProps) {
      stopAudio();
    }
    
    if (voiceSession) {
      try {
        await VoiceInterviewService.pauseInterview(voiceSession.sessionId);
      } catch (error) {
        console.error('[VoiceInterview] Error pausing interview:', error);
      }
    }
  };

  const resumeInterview = async () => {
    setIsInterviewActive(true);
    
    if (voiceSession) {
      try {
        await VoiceInterviewService.resumeInterview(voiceSession.sessionId);
        if (livekitProps) {
          await startAudio();
        }
        if (speechSupported && !isListening) {
          startListening();
        }
      } catch (error) {
        console.error('[VoiceInterview] Error resuming interview:', error);
      }
    }
  };

  const endInterview = async () => {
    setIsInterviewActive(false);
    stopListening();
    
    // Stop all audio
    audioElementsRef.current.forEach(audio => {
      audio.pause();
    });
    
    if (speechSynthesisRef.current) {
      speechSynthesisRef.current.cancel();
    }
    
    if (livekitProps) {
      stopAudio();
      disconnectLiveKit();
    }
    
    if (voiceSession) {
      try {
        await VoiceInterviewService.endInterview(voiceSession.sessionId);
      } catch (error) {
        console.error('[VoiceInterview] Error ending interview:', error);
      }
    }
    
    onEndInterview(simulator);
  };

  const handleEndInterviewClick = () => {
    setShowEndConfirmation(true);
  };

  const confirmEndInterview = () => {
    setShowEndConfirmation(false);
    endInterview();
  };

  const cancelEndInterview = () => {
    setShowEndConfirmation(false);
  };

  const toggleMicrophone = async () => {
    if (isListening) {
      stopListening();
      setUserSpeaking(false);
      if (livekitProps) {
        stopAudio();
      }
    } else {
      if (livekitProps) {
        await startAudio();
      }
      startListening();
      setUserSpeaking(true);
    }
  };

  const testAudio = () => {
    const testMessage = "This is a test of the audio system. If you can hear this, the audio is working correctly.";
    setAudioTestResult('none');
    speakTextFallback(testMessage);
  };

  const getConnectionStatusColor = () => {
    switch (connectionStatus) {
      case 'connected': return 'text-green-600 bg-green-100';
      case 'connecting': return 'text-yellow-600 bg-yellow-100';
      case 'error': return 'text-red-600 bg-red-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const getConnectionStatusText = () => {
    switch (connectionStatus) {
      case 'connected': return 'Voice Connected';
      case 'connecting': return 'Connecting...';
      case 'error': return 'Connection Error';
      default: return 'Disconnected';
    }
  };

  const progress = simulator.getProgress();

  // Safe participant count with null checks
  const participantCount = room?.participants?.size ?? 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">
      <div className="container mx-auto px-4 py-6">
        <div className="max-w-6xl mx-auto">
          {/* Autoplay Prompt Modal */}
          {showAutoplayPrompt && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-2xl p-8 max-w-md mx-4">
                <div className="text-center">
                  <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Volume2 className="w-8 h-8" />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2">Enable Audio</h3>
                  <p className="text-gray-600 mb-6">
                    Your browser requires user interaction to play audio. Click the button below to enable audio for the AI interviewer.
                  </p>
                  <button
                    onClick={enableAudio}
                    className="w-full px-6 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-300 transition-all"
                  >
                    <Volume2 className="w-4 h-4 mr-2 inline" />
                    Enable Audio
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* End Interview Confirmation Modal */}
          {showEndConfirmation && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-2xl p-8 max-w-md mx-4">
                <div className="text-center">
                  <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
                    <StopCircle className="w-8 h-8" />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2">End Voice Interview?</h3>
                  <p className="text-gray-600 mb-6">
                    Are you sure you want to end the voice interview? You'll receive analytics based on the conversation so far.
                  </p>
                  <div className="flex space-x-4">
                    <button
                      onClick={cancelEndInterview}
                      className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded-xl hover:bg-gray-300 transition-colors"
                    >
                      Continue Interview
                    </button>
                    <button
                      onClick={confirmEndInterview}
                      className="flex-1 px-4 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors"
                    >
                      End & Analyze
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Provider Selection Modal */}
          {showProviderSelection && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-2xl p-8 max-w-md mx-4">
                <div className="text-center">
                  <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Settings className="w-8 h-8" />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2">Choose AI Provider</h3>
                  <p className="text-gray-600 mb-6">
                    Select your preferred AI provider for the voice interview experience.
                  </p>
                  
                  <div className="space-y-3 mb-6">
                    <button
                      onClick={() => setSelectedProvider('google')}
                      className={`w-full p-4 rounded-xl border-2 transition-all ${
                        selectedProvider === 'google' 
                          ? 'border-purple-500 bg-purple-50' 
                          : 'border-gray-200 hover:border-purple-300'
                      }`}
                    >
                      <div className="flex items-center">
                        <Brain className="w-6 h-6 text-purple-600 mr-3" />
                        <div className="text-left">
                          <div className="font-semibold text-gray-900">Google Cloud AI</div>
                          <div className="text-sm text-gray-600">Advanced speech recognition & Gemini AI</div>
                        </div>
                      </div>
                    </button>
                    
                    <button
                      onClick={() => setSelectedProvider('openai')}
                      className={`w-full p-4 rounded-xl border-2 transition-all ${
                        selectedProvider === 'openai' 
                          ? 'border-blue-500 bg-blue-50' 
                          : 'border-gray-200 hover:border-blue-300'
                      }`}
                    >
                      <div className="flex items-center">
                        <Zap className="w-6 h-6 text-blue-600 mr-3" />
                        <div className="text-left">
                          <div className="font-semibold text-gray-900">OpenAI</div>
                          <div className="text-sm text-gray-600">GPT-4 with Whisper speech processing</div>
                        </div>
                      </div>
                    </button>
                  </div>
                  
                  <div className="flex space-x-4">
                    <button
                      onClick={() => setShowProviderSelection(false)}
                      className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded-xl hover:bg-gray-300 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={startVoiceInterview}
                      className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors"
                    >
                      Start Interview
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Header */}
          <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 flex items-center">
                  <Phone className="w-6 h-6 mr-2 text-blue-600" />
                  Voice Interview - {config.style.charAt(0).toUpperCase() + config.style.slice(1).replace('-', ' ')}
                </h1>
                <p className="text-gray-600">Topic: {config.topic}</p>
                {config.companyName && (
                  <p className="text-gray-600">Company: {config.companyName}</p>
                )}
                {aiAgentStatus && (
                  <div className="mt-2 flex items-center space-x-4 text-sm">
                    <span className="text-purple-600">
                      Powered by {aiAgentStatus.provider?.toUpperCase() || 'AI'} Agent
                    </span>
                    {aiAgentStatus.conversational && (
                      <span className="text-green-600">Conversational Mode</span>
                    )}
                  </div>
                )}
              </div>
              <div className="text-right">
                <div className="flex items-center text-lg font-semibold text-blue-600 mb-2">
                  <Clock className="w-5 h-5 mr-2" />
                  {formatTime(elapsedTime)}
                </div>
                <div className="text-sm text-gray-600 mb-2">
                  Duration: {config.duration} minutes
                </div>
                <div className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${getConnectionStatusColor()}`}>
                  {connectionStatus === 'connecting' ? (
                    <Loader className="w-4 h-4 mr-1 animate-spin" />
                  ) : connectionStatus === 'connected' ? (
                    <Signal className="w-4 h-4 mr-1" />
                  ) : connectionStatus === 'error' ? (
                    <AlertCircle className="w-4 h-4 mr-1" />
                  ) : (
                    <WifiOff className="w-4 h-4 mr-1" />
                  )}
                  {getConnectionStatusText()}
                </div>
              </div>
            </div>

            {/* Error Display */}
            {connectionStatus === 'error' && livekitError && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-start">
                  <AlertCircle className="w-5 h-5 text-red-600 mr-3 mt-0.5 flex-shrink-0" />
                  <div className="text-red-800 text-sm">
                    <p className="font-medium mb-1">Connection Error</p>
                    <p className="mb-2">{livekitError}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Progress Bar */}
            <div className="mb-4">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium text-gray-700">
                  Question {progress.current} of {progress.total}
                </span>
                <span className="text-sm text-gray-600">
                  {Math.round(progress.percentage)}% Complete
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-gradient-to-r from-blue-500 to-purple-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress.percentage}%` }}
                />
              </div>
            </div>

            {/* Voice Controls */}
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                {!isInterviewActive ? (
                  <>
                    <button
                      onClick={() => setShowProviderSelection(true)}
                      disabled={isThinking}
                      className="inline-flex items-center px-6 py-3 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 focus:outline-none focus:ring-4 focus:ring-green-300 transition-all disabled:opacity-50"
                    >
                      {isThinking ? (
                        <Loader className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Phone className="w-4 h-4 mr-2" />
                      )}
                      {startTime ? 'Resume Voice Interview' : 'Start Voice Interview'}
                    </button>
                    
                    <button
                      onClick={testAudio}
                      className="inline-flex items-center px-4 py-3 bg-purple-600 text-white font-semibold rounded-xl hover:bg-purple-700 focus:outline-none focus:ring-4 focus:ring-purple-300 transition-all"
                    >
                      <Volume2 className="w-4 h-4 mr-2" />
                      Test Audio
                      {audioTestResult === 'success' && <CheckCircle className="w-4 h-4 ml-2 text-green-300" />}
                      {audioTestResult === 'failed' && <XCircle className="w-4 h-4 ml-2 text-red-300" />}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={pauseInterview}
                    className="inline-flex items-center px-6 py-3 bg-yellow-600 text-white font-semibold rounded-xl hover:bg-yellow-700 focus:outline-none focus:ring-4 focus:ring-yellow-300 transition-all"
                  >
                    <Pause className="w-4 h-4 mr-2" />
                    Pause Interview
                  </button>
                )}
                
                <button
                  onClick={handleEndInterviewClick}
                  className="inline-flex items-center px-6 py-3 bg-red-600 text-white font-semibold rounded-xl hover:bg-red-700 focus:outline-none focus:ring-4 focus:ring-red-300 transition-all"
                >
                  <PhoneOff className="w-4 h-4 mr-2" />
                  End Interview
                </button>
              </div>

              <div className="flex items-center space-x-3">
                <div className="text-sm text-gray-600">
                  Participants: {participantCount}
                </div>
                <Users className="w-5 h-5 text-gray-400" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Live Conversation */}
            <div className="lg:col-span-2">
              <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
                <div className="flex items-center mb-4">
                  <div className="w-12 h-12 bg-gradient-to-r from-purple-500 to-blue-500 rounded-full flex items-center justify-center mr-4">
                    <MessageCircle className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Live {aiAgentStatus?.provider?.toUpperCase() || 'AI'} Conversation</h3>
                    <p className="text-sm text-gray-600 flex items-center">
                      <span className="mr-2">(Real-time)</span>
                      {isAISpeaking && (
                        <span className="text-purple-600 flex items-center">
                          <Volume2 className="w-4 h-4 mr-1" />
                          AI Speaking
                        </span>
                      )}
                      {userSpeaking && !isAISpeaking && (
                        <span className="text-green-600 flex items-center">
                          <Mic className="w-4 h-4 mr-1" />
                          You're Speaking
                        </span>
                      )}
                      {!isAISpeaking && !userSpeaking && isInterviewActive && (
                        <span className="text-blue-600 flex items-center">
                          <Signal className="w-4 h-4 mr-1" />
                          Listening...
                        </span>
                      )}
                    </p>
                  </div>
                </div>

                <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-xl p-6 min-h-[300px] max-h-[400px] overflow-y-auto">
                  {currentQuestion && (
                    <div className="mb-6 p-4 bg-white rounded-lg border border-purple-200">
                      <div className="flex items-center mb-2">
                        <Brain className="w-5 h-5 text-purple-600 mr-2" />
                        <span className="font-semibold text-purple-900">Current Question</span>
                      </div>
                      <p className="text-gray-800">{currentQuestion}</p>
                    </div>
                  )}

                  {conversationHistory.length > 0 ? (
                    <div className="space-y-4">
                      {conversationHistory.map((entry, index) => (
                        <div key={index} className={`flex ${entry.speaker === 'user' ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[80%] p-3 rounded-lg ${
                            entry.speaker === 'user' 
                              ? 'bg-blue-500 text-white' 
                              : 'bg-white text-gray-800 border border-purple-200'
                          }`}>
                            <div className="flex items-center mb-1">
                              {entry.speaker === 'user' ? (
                                <Mic className="w-4 h-4 mr-2" />
                              ) : (
                                <Brain className="w-4 h-4 mr-2 text-purple-600" />
                              )}
                              <span className="text-xs font-medium">
                                {entry.speaker === 'user' ? 'You' : `${aiAgentStatus?.provider?.toUpperCase() || 'AI'} Interviewer`}
                              </span>
                              <span className="text-xs opacity-70 ml-2">
                                {new Date(entry.timestamp).toLocaleTimeString()}
                              </span>
                            </div>
                            <p className="text-sm">{entry.message}</p>
                            {entry.type && (
                              <span className={`text-xs px-2 py-1 rounded-full mt-2 inline-block ${
                                entry.type === 'greeting' ? 'bg-green-100 text-green-700' :
                                entry.type === 'question' ? 'bg-blue-100 text-blue-700' :
                                entry.type === 'speaking' ? 'bg-yellow-100 text-yellow-700' :
                                'bg-gray-100 text-gray-700'
                              }`}>
                                {entry.type}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full text-gray-500">
                      <Phone className="w-8 h-8 mr-3" />
                      <span>Click "Start Voice Interview" to begin the conversation</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Voice Response Interface */}
              <div className="bg-white rounded-2xl shadow-lg p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                  <Mic className="w-5 h-5 mr-2 text-blue-600" />
                  Voice Response ({aiAgentStatus?.provider?.toUpperCase() || 'AI'} Managed)
                </h3>
                
                <div className="space-y-4">
                  {/* Live Transcript */}
                  <div className="bg-gray-50 rounded-xl p-4 min-h-[120px]">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-700">Live Transcript ({aiAgentStatus?.provider?.toUpperCase() || 'Browser'} Speech-to-Text)</span>
                      {isListening && (
                        <div className="flex items-center text-sm text-green-600">
                          <div className="w-2 h-2 bg-green-600 rounded-full animate-pulse mr-2"></div>
                          AI Managed
                        </div>
                      )}
                    </div>
                    <p className="text-gray-800">
                      {transcript || 'Your speech will appear here in real-time...'}
                    </p>
                  </div>

                  {/* Audio Level Indicator */}
                  {localAudioTrack && (
                    <div className="flex items-center space-x-3">
                      <Volume2 className="w-5 h-5 text-gray-600" />
                      <div className="flex-1 bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-gradient-to-r from-green-400 to-blue-500 h-2 rounded-full transition-all duration-100"
                          style={{ width: `${audioLevel}%` }}
                        />
                      </div>
                      <span className="text-sm text-gray-600">{Math.round(audioLevel)}%</span>
                    </div>
                  )}

                  {/* Voice Controls */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      {speechSupported && (
                        <button
                          onClick={toggleMicrophone}
                          disabled={!isInterviewActive || connectionStatus !== 'connected'}
                          className={`p-4 rounded-xl transition-all ${
                            isListening
                              ? 'bg-green-100 text-green-600'
                              : 'bg-blue-100 text-blue-600 hover:bg-blue-200'
                          } disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                          {isListening ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
                        </button>
                      )}
                      
                      <div className="text-sm text-gray-600">
                        {aiAgentStatus?.conversational 
                          ? `${aiAgentStatus.provider?.toUpperCase() || 'AI'} is managing the conversation flow automatically`
                          : isListening ? 'Click to stop recording' : 'Click to start recording'
                        }
                      </div>
                    </div>

                    <div className="text-sm text-purple-600">
                      Powered by {aiAgentStatus?.provider?.toUpperCase() || 'AI'} Agent
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Notes Section */}
            <div className="bg-white rounded-2xl shadow-lg p-6">
              <div className="flex items-center mb-4">
                <FileText className="w-5 h-5 text-gray-600 mr-2" />
                <h3 className="text-lg font-semibold text-gray-900">Interview Notes</h3>
              </div>
              
              <textarea
                ref={notesRef}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Jot down key points, thoughts, or reminders during the voice interview..."
                className="w-full h-64 px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none transition-colors"
              />
              
              <div className="mt-4 text-xs text-gray-500">
                Your notes will be saved and available in the analytics section.
              </div>

              {/* AI Status */}
              <div className="mt-6 p-4 bg-purple-50 rounded-xl">
                <h4 className="font-medium text-purple-900 mb-2">{aiAgentStatus?.provider?.toUpperCase() || 'AI'} Status</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-purple-700">LiveKit:</span>
                    <span className={connectionStatus === 'connected' ? 'text-green-600' : 'text-red-600'}>
                      {getConnectionStatusText()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-purple-700">Audio Track:</span>
                    <span className={localAudioTrack ? 'text-green-600' : 'text-gray-600'}>
                      {localAudioTrack ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-purple-700">Remote Audio:</span>
                    <span className={remoteAudioTracks.length > 0 ? 'text-green-600' : 'text-gray-600'}>
                      {remoteAudioTracks.length} tracks
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-purple-700">AI Agent:</span>
                    <span className={aiAgentStatus?.enabled ? 'text-green-600' : 'text-red-600'}>
                      {aiAgentStatus?.enabled ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-purple-700">Mode:</span>
                    <span className="text-green-600">
                      {aiAgentStatus?.conversational ? 'Conversational' : 'Standard'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-purple-700">Provider:</span>
                    <span className="text-purple-600">
                      {aiAgentStatus?.provider?.toUpperCase() || 'Not Set'}
                    </span>
                  </div>
                  {voiceSession && (
                    <div className="mt-3 pt-2 border-t border-purple-200">
                      <div className="text-xs text-purple-600">
                        <div><strong>Session:</strong> {voiceSession.sessionId}</div>
                        <div><strong>Room:</strong> {voiceSession.roomName}</div>
                        <div><strong>Token Length:</strong> {voiceSession.participantToken?.length || 0}</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};