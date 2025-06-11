import React, { useState, useEffect, useRef } from 'react';
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
  Signal
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
  const [currentQuestion, setCurrentQuestion] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isThinking, setIsThinking] = useState(false);
  const [voiceSession, setVoiceSession] = useState<any>(null);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [audioLevel, setAudioLevel] = useState(0);
  const [participantName] = useState(`participant-${Date.now()}`);
  
  const {
    isListening,
    transcript,
    startListening,
    stopListening,
    resetTranscript,
    isSupported: speechSupported
  } = useSpeechRecognition();

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
  } = useLiveKit({
    wsUrl: voiceSession?.wsUrl || '',
    token: voiceSession?.participantToken || '',
    onConnected: () => {
      setConnectionStatus('connected');
      console.log('Connected to LiveKit room');
    },
    onDisconnected: () => {
      setConnectionStatus('disconnected');
      console.log('Disconnected from LiveKit room');
    },
    onError: (error) => {
      setConnectionStatus('error');
      console.error('LiveKit error:', error);
    }
  });

  const notesRef = useRef<HTMLTextAreaElement>(null);

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

  // Audio level monitoring
  useEffect(() => {
    if (localAudioTrack) {
      const analyzeAudio = () => {
        // Simulate audio level for demo - in real implementation you'd analyze the audio stream
        setAudioLevel(Math.random() * 100);
      };
      
      const interval = setInterval(analyzeAudio, 100);
      return () => clearInterval(interval);
    }
  }, [localAudioTrack]);

  // Update connection status based on LiveKit state
  useEffect(() => {
    if (livekitConnecting) {
      setConnectionStatus('connecting');
    } else if (livekitConnected) {
      setConnectionStatus('connected');
    } else if (livekitError) {
      setConnectionStatus('error');
    } else {
      setConnectionStatus('disconnected');
    }
  }, [livekitConnecting, livekitConnected, livekitError]);

  const formatTime = (ms: number): string => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const startVoiceInterview = async () => {
    try {
      setIsThinking(true);
      setConnectionStatus('connecting');
      
      // Start voice interview session
      const session = await VoiceInterviewService.startVoiceInterview(config, participantName);
      setVoiceSession(session);
      setCurrentQuestion(session.firstQuestion || '');
      
      // Connect to LiveKit room
      await connectLiveKit();
      
      setIsInterviewActive(true);
      setStartTime(Date.now());
      setIsThinking(false);
    } catch (error) {
      console.error('Error starting voice interview:', error);
      setConnectionStatus('error');
      setIsThinking(false);
    }
  };

  const pauseInterview = async () => {
    setIsInterviewActive(false);
    stopListening();
    stopAudio();
    
    if (voiceSession) {
      try {
        await VoiceInterviewService.pauseInterview(voiceSession.sessionId);
      } catch (error) {
        console.error('Error pausing interview:', error);
      }
    }
  };

  const resumeInterview = async () => {
    setIsInterviewActive(true);
    
    if (voiceSession) {
      try {
        await VoiceInterviewService.resumeInterview(voiceSession.sessionId);
        await startAudio();
      } catch (error) {
        console.error('Error resuming interview:', error);
      }
    }
  };

  const endInterview = async () => {
    setIsInterviewActive(false);
    stopListening();
    stopAudio();
    disconnectLiveKit();
    
    if (voiceSession) {
      try {
        await VoiceInterviewService.endInterview(voiceSession.sessionId);
      } catch (error) {
        console.error('Error ending interview:', error);
      }
    }
    
    onEndInterview(simulator);
  };

  const submitVoiceResponse = async () => {
    if (!transcript.trim() || !voiceSession) return;

    stopListening();
    setIsThinking(true);
    
    try {
      const result = await VoiceInterviewService.processVoiceResponse(
        voiceSession.sessionId,
        transcript.trim(),
        {
          audioLevel,
          duration: elapsedTime,
          confidence: 0.9 // This would come from speech recognition
        }
      );
      
      // Update simulator with the response
      await simulator.submitResponse(transcript.trim());
      
      if (result.isComplete) {
        endInterview();
      } else if (result.nextQuestion) {
        setCurrentQuestion(result.nextQuestion.question);
        resetTranscript();
      }
    } catch (error) {
      console.error('Error submitting voice response:', error);
    }
    
    setIsThinking(false);
  };

  const toggleMicrophone = async () => {
    if (isListening) {
      stopListening();
      stopAudio();
    } else {
      await startAudio();
      startListening();
    }
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">
      <div className="container mx-auto px-4 py-6">
        <div className="max-w-6xl mx-auto">
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
                  <button
                    onClick={startVoiceInterview}
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
                  onClick={endInterview}
                  className="inline-flex items-center px-6 py-3 bg-red-600 text-white font-semibold rounded-xl hover:bg-red-700 focus:outline-none focus:ring-4 focus:ring-red-300 transition-all"
                >
                  <PhoneOff className="w-4 h-4 mr-2" />
                  End Interview
                </button>
              </div>

              <div className="flex items-center space-x-3">
                <div className="text-sm text-gray-600">
                  Participants: {room?.participants.size || 0}
                </div>
                <Users className="w-5 h-5 text-gray-400" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* AI Interviewer */}
            <div className="lg:col-span-2">
              <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
                <div className="flex items-center mb-4">
                  <div className="w-12 h-12 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full flex items-center justify-center mr-4">
                    <MessageCircle className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">AI Voice Interviewer</h3>
                    <p className="text-sm text-gray-600">
                      Real-time voice conversation powered by LiveKit
                    </p>
                  </div>
                </div>

                <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl p-6 min-h-[200px]">
                  {isThinking ? (
                    <div className="flex items-center justify-center h-full">
                      <Loader className="w-6 h-6 text-blue-600 animate-spin mr-3" />
                      <span className="text-gray-600">AI is processing your response...</span>
                    </div>
                  ) : currentQuestion ? (
                    <div>
                      <p className="text-lg text-gray-800 leading-relaxed mb-4">{currentQuestion}</p>
                      {isInterviewActive && connectionStatus === 'connected' && (
                        <div className="flex items-center text-sm text-blue-600">
                          <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse mr-2"></div>
                          Voice interview active - speak your response
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full text-gray-500">
                      <Phone className="w-8 h-8 mr-3" />
                      <span>Click "Start Voice Interview" to begin</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Voice Response Interface */}
              <div className="bg-white rounded-2xl shadow-lg p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                  <Mic className="w-5 h-5 mr-2 text-blue-600" />
                  Voice Response
                </h3>
                
                <div className="space-y-4">
                  {/* Live Transcript */}
                  <div className="bg-gray-50 rounded-xl p-4 min-h-[120px]">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-700">Live Transcript</span>
                      {isListening && (
                        <div className="flex items-center text-sm text-red-600">
                          <div className="w-2 h-2 bg-red-600 rounded-full animate-pulse mr-2"></div>
                          Recording...
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
                              ? 'bg-red-100 text-red-600 animate-pulse'
                              : 'bg-blue-100 text-blue-600 hover:bg-blue-200'
                          } disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                          {isListening ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
                        </button>
                      )}
                      
                      <div className="text-sm text-gray-600">
                        {isListening ? 'Click to stop recording' : 'Click to start recording'}
                      </div>
                    </div>

                    <button
                      onClick={submitVoiceResponse}
                      disabled={!isInterviewActive || !transcript.trim() || isThinking}
                      className="inline-flex items-center px-6 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                      <Send className="w-4 h-4 mr-2" />
                      Submit Response
                    </button>
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

              {/* Connection Info */}
              <div className="mt-6 p-4 bg-blue-50 rounded-xl">
                <h4 className="font-medium text-blue-900 mb-2">Voice Connection Status</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-blue-700">LiveKit:</span>
                    <span className={connectionStatus === 'connected' ? 'text-green-600' : 'text-red-600'}>
                      {getConnectionStatusText()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-blue-700">Audio Track:</span>
                    <span className={localAudioTrack ? 'text-green-600' : 'text-gray-600'}>
                      {localAudioTrack ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-blue-700">Remote Audio:</span>
                    <span className={remoteAudioTracks.length > 0 ? 'text-green-600' : 'text-gray-600'}>
                      {remoteAudioTracks.length} tracks
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};