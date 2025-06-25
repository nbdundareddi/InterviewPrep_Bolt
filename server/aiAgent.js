import { WorkerOptions, cli, defineAgent } from '@livekit/agents';
import WebSocket from 'ws';
import { Readable } from 'stream';
import dotenv from 'dotenv';
import { LLMQuestionGenerator } from './llmService.js';

dotenv.config();

/**
 * Multi-Provider AI Interview Agent using LiveKit Agents Framework
 * Supports both OpenAI and Google Cloud services for voice interviews
 */
export class MultiProviderAIInterviewAgent {
  constructor() {
    this.llmService = new LLMQuestionGenerator();
    this.interviewSessions = new Map();
    this.questionCache = new Map();
    this.provider = process.env.VOICE_AGENT_PROVIDER || 'google';
    
    // Initialize the selected provider
    this.initializeProvider();
    
    console.log(`🤖 Multi-Provider AI Interview Agent initialized with ${this.provider.toUpperCase()} provider`);
  }

  /**
   * Initialize the selected AI provider
   */
  async initializeProvider() {
    try {
      if (this.provider === 'openai') {
        await this.initializeOpenAI();
      } else if (this.provider === 'google') {
        await this.initializeGoogle();
      } else {
        throw new Error(`Unsupported provider: ${this.provider}`);
      }
    } catch (error) {
      console.error(`❌ Failed to initialize ${this.provider} provider:`, error);
      console.log('🔄 Falling back to basic functionality');
      this.useBasicMode = true;
    }
  }

  /**
   * Initialize OpenAI services
   */
  async initializeOpenAI() {
    try {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY not found');
      }

      // Initialize OpenAI client for TTS and STT
      this.openaiApiKey = process.env.OPENAI_API_KEY;

      console.log('✅ OpenAI services initialized (API Key configured)');
      this.useOpenAI = true;

    } catch (error) {
      console.error('❌ OpenAI initialization failed:', error);
      throw error;
    }
  }

  /**
   * Initialize Google Cloud services
   */
  async initializeGoogle() {
    try {
      // Initialize Google Gemini AI
      if (process.env.GEMINI_API_KEY) {
        const { GoogleGenerativeAI } = await import('@google/generative-ai');
        this.geminiAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        this.geminiModel = this.geminiAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
        console.log('✅ Gemini AI initialized');
      }

      // Initialize Google Cloud Speech-to-Text
      if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        const speech = await import('@google-cloud/speech');
        this.speechClient = new speech.SpeechClient({
          keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
          projectId: process.env.GOOGLE_CLOUD_PROJECT_ID
        });
        console.log('✅ Google Speech-to-Text initialized');
      }

      // Initialize Google Cloud Text-to-Speech
      if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        const textToSpeech = await import('@google-cloud/text-to-speech');
        this.ttsClient = new textToSpeech.TextToSpeechClient({
          keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
          projectId: process.env.GOOGLE_CLOUD_PROJECT_ID
        });
        console.log('✅ Google Text-to-Speech initialized');
      }

      this.useGoogle = true;

    } catch (error) {
      console.error('❌ Google Cloud initialization failed:', error);
      throw error;
    }
  }

  /**
   * Create and configure the LiveKit agent
   */
  createAgent() {
    return defineAgent({
      entry: this.handleRoomConnection.bind(this)
    });
  }

  /**
   * Handle new room connections
   */
  async handleRoomConnection(ctx) {
    const { room } = ctx;
    
    console.log(`🎙️ ${this.provider.toUpperCase()} AI Agent connected to room: ${room.name}`);
    
    // Wait for participant to join
    await this.waitForParticipant(ctx);
    
    // Initialize interview session
    const sessionData = await this.initializeInterviewSession(ctx);
    
    if (!sessionData) {
      console.error('❌ Failed to initialize interview session');
      return;
    }

    // Set up audio processing based on provider
    await this.setupAudioProcessing(ctx, sessionData);
    
    // Set up data message handling for user turn signals
    this.setupDataMessageHandling(ctx, sessionData);
    
    // Begin interview flow
    await this.startInterviewFlow(ctx, sessionData);
    
    console.log(`✅ Interview session started for room: ${room.name} using ${this.provider.toUpperCase()}`);
  }

  /**
   * Set up data message handling for user turn signals
   */
  setupDataMessageHandling(ctx, sessionData) {
    const { room } = ctx;
    
    room.on('dataReceived', async (payload, participant) => {
      try {
        const data = JSON.parse(new TextDecoder().decode(payload));
        console.log(`📨 Data received from ${participant?.identity}:`, data);
        
        // Handle user turn ended signal
        if (data.type === 'user_turn_ended') {
          console.log('🎤 User turn ended signal received');
          
          // Check if we have a final transcript to process
          if (sessionData.lastFinalTranscript && sessionData.lastFinalTranscript.trim().length > 0) {
            console.log(`📝 Processing final transcript: "${sessionData.lastFinalTranscript}"`);
            
            // Process the user's complete response
            await this.processUserResponse(sessionData.lastFinalTranscript, sessionData);
            
            // Clear the transcript to prevent re-processing
            sessionData.lastFinalTranscript = '';
          } else if (data.transcript && data.transcript.trim().length > 0) {
            // Fallback: use transcript from the data message if no final transcript stored
            console.log(`📝 Processing transcript from data message: "${data.transcript}"`);
            await this.processUserResponse(data.transcript, sessionData);
          } else {
            console.warn('⚠️ User turn ended but no transcript available to process');
          }
          
          // Temporarily stop listening until AI responds
          sessionData.isListening = false;
        }
      } catch (error) {
        console.error('❌ Error processing data message:', error);
      }
    });
  }

  /**
   * Wait for a participant to join the room
   */
  async waitForParticipant(ctx) {
    const { room } = ctx;
    
    if (room.remoteParticipants.length === 0) {
      console.log('⏳ Waiting for participant to join...');
      
      return new Promise((resolve) => {
        const onParticipantConnected = () => {
          console.log('👤 Participant joined the room');
          room.off('participantConnected', onParticipantConnected);
          resolve();
        };
        
        room.on('participantConnected', onParticipantConnected);
      });
    }
  }

  /**
   * Initialize interview session from room metadata
   */
  async initializeInterviewSession(ctx) {
    const { room } = ctx;
    
    try {
      // Extract interview configuration from room metadata or environment
      let config;
      
      if (room.metadata) {
        const roomMetadata = JSON.parse(room.metadata);
        config = roomMetadata.interviewConfig;
      } else if (process.env.INTERVIEW_CONFIG) {
        config = JSON.parse(process.env.INTERVIEW_CONFIG);
      }
      
      if (!config) {
        console.error('❌ No interview configuration found');
        return null;
      }

      const sessionData = {
        sessionId: room.name,
        config,
        currentQuestionIndex: 0,
        questions: [],
        responses: [],
        startTime: Date.now(),
        status: 'greeting',
        conversationHistory: [],
        isAISpeaking: false,
        isListening: false,
        lastFinalTranscript: '', // Store the last complete transcript
        provider: this.provider
      };

      // Pre-generate first few questions
      await this.preGenerateQuestions(sessionData, 3);
      
      this.interviewSessions.set(room.name, sessionData);
      
      console.log(`📋 Interview session initialized with ${this.provider.toUpperCase()}:`, {
        topic: config.topic,
        style: config.style,
        experienceLevel: config.experienceLevel,
        duration: config.duration
      });
      
      return sessionData;
      
    } catch (error) {
      console.error('❌ Error initializing interview session:', error);
      return null;
    }
  }

  /**
   * Set up audio processing based on provider
   */
  async setupAudioProcessing(ctx, sessionData) {
    const { room } = ctx;
    
    try {
      if (this.provider === 'openai' && this.useOpenAI) {
        await this.setupOpenAIAudioProcessing(ctx, sessionData);
      } else if (this.provider === 'google' && this.useGoogle) {
        await this.setupGoogleAudioProcessing(ctx, sessionData);
      } else {
        await this.setupBasicAudioProcessing(ctx, sessionData);
      }
      
      console.log(`🎵 ${this.provider.toUpperCase()} audio processing setup complete`);
      
    } catch (error) {
      console.error('❌ Error setting up audio processing:', error);
    }
  }

  /**
   * Set up OpenAI audio processing
   */
  async setupOpenAIAudioProcessing(ctx, sessionData) {
    const { room } = ctx;
    
    // Create audio source for AI speech output
    sessionData.audioSource = await ctx.room.localParticipant.createAudioSource({
      sampleRate: 48000,
      numChannels: 1
    });
    
    // Create and publish audio track
    sessionData.audioTrack = await ctx.room.localParticipant.createAudioTrack({
      source: sessionData.audioSource,
      name: 'ai-speech'
    });
    
    // CRITICAL: Publish the audio track so participants can hear the AI
    await ctx.room.localParticipant.publishTrack(sessionData.audioTrack);
    console.log('🎵 OpenAI AI audio track published to room');
    
    // Set up audio frame processing for STT
    room.on('trackSubscribed', (track, publication, participant) => {
      if (track.kind === 'audio' && participant.identity !== 'ai-interviewer') {
        console.log('🎤 Subscribed to participant audio track (OpenAI STT)');
        
        // Set up audio frame processing
        this.setupOpenAISTT(track, sessionData);
      }
    });
  }

  /**
   * Set up Google Cloud audio processing
   */
  async setupGoogleAudioProcessing(ctx, sessionData) {
    const { room } = ctx;
    
    // Create audio source for AI speech output
    sessionData.audioSource = await ctx.room.localParticipant.createAudioSource({
      sampleRate: 48000,
      numChannels: 1
    });
    
    // Create and publish audio track
    sessionData.audioTrack = await ctx.room.localParticipant.createAudioTrack({
      source: sessionData.audioSource,
      name: 'ai-speech'
    });
    
    // CRITICAL: Publish the audio track so participants can hear the AI
    await ctx.room.localParticipant.publishTrack(sessionData.audioTrack);
    console.log('🎵 Google AI audio track published to room');
    
    // Set up Google Speech-to-Text
    if (this.speechClient) {
      const recognizeStream = this.speechClient
        .streamingRecognize({
          config: {
            encoding: 'LINEAR16',
            sampleRateHertz: 48000,
            languageCode: 'en-US',
            enableAutomaticPunctuation: true,
            enableWordTimeOffsets: true,
            model: 'latest_long'
          },
          interimResults: true,
          singleUtterance: false
        })
        .on('data', (data) => {
          this.handleGoogleSpeechResult(data, sessionData);
        })
        .on('error', (error) => {
          console.error('❌ Google Speech recognition error:', error);
        });

      // Listen for audio from participants
      room.on('trackSubscribed', (track, publication, participant) => {
        if (track.kind === 'audio' && participant.identity !== 'ai-interviewer') {
          console.log('🎤 Subscribed to participant audio track (Google STT)');
          
          // Set up audio frame processing
          this.setupGoogleSTT(track, recognizeStream, sessionData);
        }
      });

      sessionData.recognizeStream = recognizeStream;
    }
  }

  /**
   * Set up basic audio processing (fallback)
   */
  async setupBasicAudioProcessing(ctx, sessionData) {
    console.log('⚠️ Using basic audio processing (no STT/TTS)');
    
    // Create audio source for basic audio output
    sessionData.audioSource = await ctx.room.localParticipant.createAudioSource({
      sampleRate: 48000,
      numChannels: 1
    });
    
    // Create and publish audio track
    sessionData.audioTrack = await ctx.room.localParticipant.createAudioTrack({
      source: sessionData.audioSource,
      name: 'ai-speech'
    });
    
    // CRITICAL: Publish the audio track so participants can hear the AI
    await ctx.room.localParticipant.publishTrack(sessionData.audioTrack);
    console.log('🎵 Basic AI audio track published to room');
  }

  /**
   * Set up OpenAI Speech-to-Text processing
   */
  setupOpenAISTT(track, sessionData) {
    // Buffer audio data for OpenAI Whisper processing
    let audioBuffer = [];
    const bufferDuration = 3000; // 3 seconds
    
    track.on('audioFrame', async (frame) => {
      if (sessionData.isListening && !sessionData.isAISpeaking) {
        audioBuffer.push(frame.data);
        
        // Process buffer every 3 seconds
        if (audioBuffer.length > bufferDuration / 40) { // 40ms frames
          try {
            const audioData = Buffer.concat(audioBuffer);
            const transcript = await this.processOpenAISTT(audioData);
            
            if (transcript && transcript.trim().length > 0) {
              // Store the final transcript instead of processing immediately
              sessionData.lastFinalTranscript = transcript.trim();
              console.log(`🎤 OpenAI STT final transcript stored: "${transcript}"`);
            }
            
            audioBuffer = []; // Clear buffer
          } catch (error) {
            console.error('❌ OpenAI STT processing error:', error);
          }
        }
      }
    });
  }

  /**
   * Set up Google Speech-to-Text processing
   */
  setupGoogleSTT(track, recognizeStream, sessionData) {
    track.on('audioFrame', (frame) => {
      if (sessionData.isListening && !sessionData.isAISpeaking) {
        try {
          recognizeStream.write(frame.data);
        } catch (error) {
          console.error('❌ Error writing to Google STT stream:', error);
        }
      }
    });
  }

  /**
   * Process audio with OpenAI Whisper
   */
  async processOpenAISTT(audioData) {
    try {
      // Convert audio data to format suitable for OpenAI Whisper
      const formData = new FormData();
      const audioBlob = new Blob([audioData], { type: 'audio/wav' });
      formData.append('file', audioBlob, 'audio.wav');
      formData.append('model', 'whisper-1');
      formData.append('language', 'en');

      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.openaiApiKey}`
        },
        body: formData
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`);
      }

      const result = await response.json();
      return result.text;

    } catch (error) {
      console.error('❌ OpenAI Whisper error:', error);
      return null;
    }
  }

  /**
   * Handle Google Speech recognition results
   */
  async handleGoogleSpeechResult(data, sessionData) {
    if (data.results[0] && data.results[0].alternatives[0]) {
      const transcript = data.results[0].alternatives[0].transcript;
      const isFinal = data.results[0].isFinal;
      
      console.log(`🎤 Google Speech recognized: "${transcript}" (final: ${isFinal})`);
      
      if (isFinal && transcript.trim().length > 0) {
        // Store the final transcript instead of processing immediately
        sessionData.lastFinalTranscript = transcript.trim();
        console.log(`🎤 Google STT final transcript stored: "${transcript}"`);
      }
    }
  }

  /**
   * Start the interview flow
   */
  async startInterviewFlow(ctx, sessionData) {
    // Send initial greeting
    const greeting = this.createGreeting(sessionData.config);
    await this.speakText(greeting, sessionData);
    
    // Send greeting as data message to frontend
    await this.sendDataMessage(ctx, {
      type: 'greeting',
      text: greeting,
      timestamp: Date.now()
    });
    
    // Add to conversation history
    sessionData.conversationHistory.push({
      speaker: 'ai',
      message: greeting,
      timestamp: Date.now(),
      type: 'greeting'
    });
    
    sessionData.status = 'ready_check';
    
    console.log(`🎙️ Interview flow started with ${this.provider.toUpperCase()}, waiting for participant response`);
  }

  /**
   * Send data message to frontend
   */
  async sendDataMessage(ctx, data) {
    try {
      const message = JSON.stringify(data);
      const encoder = new TextEncoder();
      await ctx.room.localParticipant.publishData(encoder.encode(message));
      console.log('📨 Data message sent to frontend:', data.type);
    } catch (error) {
      console.error('❌ Error sending data message:', error);
    }
  }

  /**
   * Create personalized greeting
   */
  createGreeting(config) {
    const providerName = this.provider === 'openai' ? 'OpenAI' : 'Google AI';
    
    const greetings = [
      `Hello! Welcome to your ${config.style} interview practice session. I'm your ${providerName} interviewer, and I'm excited to help you practice for your ${config.topic} interview.`,
      `Hi there! I'm your ${providerName} interview coach. Today we'll be conducting a ${config.style} interview focused on ${config.topic}. This will be great practice for you!`,
      `Welcome! I'm here to help you practice your interview skills using ${providerName} technology. We'll be doing a ${config.style} interview about ${config.topic} today.`
    ];
    
    const greeting = greetings[Math.floor(Math.random() * greetings.length)];
    const readyCheck = "Are you ready to begin? Just say 'yes' or 'I'm ready' when you'd like to start!";
    
    return `${greeting} ${readyCheck}`;
  }

  /**
   * Convert text to speech using the selected provider
   */
  async speakText(text, sessionData) {
    try {
      sessionData.isAISpeaking = true;
      sessionData.isListening = false;
      
      console.log(`🗣️ ${this.provider.toUpperCase()} AI speaking: "${text.substring(0, 50)}..."`);
      
      if (this.provider === 'openai' && this.useOpenAI) {
        await this.speakWithOpenAI(text, sessionData);
      } else if (this.provider === 'google' && this.ttsClient) {
        await this.speakWithGoogle(text, sessionData);
      } else {
        // Fallback: simulate speaking delay
        await new Promise(resolve => setTimeout(resolve, text.length * 50));
      }
      
      // Resume listening after speaking with a delay
      setTimeout(() => {
        sessionData.isAISpeaking = false;
        sessionData.isListening = true;
        console.log(`👂 ${this.provider.toUpperCase()} AI finished speaking, now listening...`);
      }, 1000);
      
    } catch (error) {
      console.error(`❌ Error in ${this.provider} text-to-speech:`, error);
      sessionData.isAISpeaking = false;
      sessionData.isListening = true;
    }
  }

  /**
   * Speak text using OpenAI TTS
   */
  async speakWithOpenAI(text, sessionData) {
    try {
      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.openaiApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'tts-1',
          voice: 'nova',
          input: text,
          response_format: 'wav'
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI TTS API error: ${response.status}`);
      }

      const audioBuffer = await response.arrayBuffer();
      
      if (sessionData.audioSource && audioBuffer) {
        await this.playAudioBuffer(new Uint8Array(audioBuffer), sessionData);
      }
      
    } catch (error) {
      console.error('❌ OpenAI TTS error:', error);
    }
  }

  /**
   * Speak text using Google Cloud TTS
   */
  async speakWithGoogle(text, sessionData) {
    try {
      const [response] = await this.ttsClient.synthesizeSpeech({
        input: { text },
        voice: {
          languageCode: 'en-US',
          name: 'en-US-Neural2-F',
          ssmlGender: 'FEMALE'
        },
        audioConfig: {
          audioEncoding: 'LINEAR16',
          sampleRateHertz: 48000
        }
      });
      
      if (sessionData.audioSource && response.audioContent) {
        await this.playAudioBuffer(new Uint8Array(response.audioContent), sessionData);
      }
      
    } catch (error) {
      console.error('❌ Google TTS error:', error);
    }
  }

  /**
   * Play audio buffer through LiveKit audio source
   */
  async playAudioBuffer(audioData, sessionData) {
    try {
      if (!sessionData.audioSource) {
        console.error('❌ No audio source available');
        return;
      }

      // Convert audio data to 16-bit PCM format for LiveKit
      const frameSize = 1920; // 40ms at 48kHz mono
      
      for (let i = 0; i < audioData.length; i += frameSize * 2) {
        const frameData = audioData.slice(i, i + frameSize * 2);
        
        // Convert to Float32Array for LiveKit audio source
        const floatData = new Float32Array(frameSize);
        for (let j = 0; j < frameSize && j * 2 < frameData.length; j++) {
          // Convert 16-bit PCM to float (-1.0 to 1.0)
          const sample = (frameData[j * 2] | (frameData[j * 2 + 1] << 8));
          floatData[j] = sample / 32768.0;
        }
        
        // Send audio frame to LiveKit
        await sessionData.audioSource.captureFrame(floatData);
        
        // Small delay to maintain real-time playback
        await new Promise(resolve => setTimeout(resolve, 40));
      }
      
    } catch (error) {
      console.error('❌ Error playing audio buffer:', error);
    }
  }

  /**
   * Process user response
   */
  async processUserResponse(transcript, sessionData) {
    try {
      console.log(`📝 Processing user response: "${transcript}"`);
      
      // Add to conversation history
      sessionData.conversationHistory.push({
        speaker: 'user',
        message: transcript,
        timestamp: Date.now(),
        type: 'response'
      });
      
      // Determine next action based on current status
      if (sessionData.status === 'ready_check') {
        if (this.isReadyResponse(transcript)) {
          await this.startMainInterview(sessionData);
        } else {
          await this.handleNotReadyResponse(sessionData);
        }
      } else if (sessionData.status === 'interviewing') {
        await this.handleInterviewResponse(transcript, sessionData);
      }
      
    } catch (error) {
      console.error('❌ Error processing user response:', error);
    }
  }

  /**
   * Check if user is ready to start
   */
  isReadyResponse(transcript) {
    const readyKeywords = ['yes', 'ready', 'start', 'begin', 'sure', 'okay', 'ok', 'let\'s go'];
    const lowerTranscript = transcript.toLowerCase();
    
    return readyKeywords.some(keyword => lowerTranscript.includes(keyword));
  }

  /**
   * Start the main interview
   */
  async startMainInterview(sessionData) {
    sessionData.status = 'interviewing';
    
    const startMessage = "Excellent! Let's begin the interview. Here's your first question:";
    await this.speakText(startMessage, sessionData);
    
    // Ask first question
    await this.askNextQuestion(sessionData);
  }

  /**
   * Handle when user is not ready
   */
  async handleNotReadyResponse(sessionData) {
    const encouragement = "No problem! Take your time. When you're ready to start the interview, just let me know by saying 'I'm ready' or 'yes'.";
    await this.speakText(encouragement, sessionData);
  }

  /**
   * Handle interview response
   */
  async handleInterviewResponse(transcript, sessionData) {
    // Store the response
    const currentQuestion = sessionData.questions[sessionData.currentQuestionIndex - 1];
    
    sessionData.responses.push({
      question: currentQuestion,
      response: transcript,
      timestamp: Date.now(),
      duration: Date.now() - sessionData.startTime
    });
    
    // Generate feedback using the selected provider
    const feedback = await this.generateResponseFeedback(currentQuestion, transcript, sessionData.config);
    
    if (feedback) {
      await this.speakText(feedback, sessionData);
      
      sessionData.conversationHistory.push({
        speaker: 'ai',
        message: feedback,
        timestamp: Date.now(),
        type: 'feedback'
      });
    }
    
    // Check if interview should continue
    if (this.shouldContinueInterview(sessionData)) {
      await this.askNextQuestion(sessionData);
    } else {
      await this.endInterview(sessionData);
    }
  }

  /**
   * Ask the next question
   */
  async askNextQuestion(sessionData, ctx) {
    try {
      let question;
      
      // Use pre-generated question if available
      if (sessionData.questions.length > sessionData.currentQuestionIndex) {
        question = sessionData.questions[sessionData.currentQuestionIndex];
      } else {
        // Generate new question
        question = await this.generateNextQuestion(sessionData);
        sessionData.questions.push(question);
      }
      
      sessionData.currentQuestionIndex++;
      
      await this.speakText(question, sessionData);
      
      // Send question as data message to frontend
      if (ctx) {
        await this.sendDataMessage(ctx, {
          type: 'question',
          text: question,
          questionNumber: sessionData.currentQuestionIndex,
          timestamp: Date.now()
        });
      }
      
      sessionData.conversationHistory.push({
        speaker: 'ai',
        message: question,
        timestamp: Date.now(),
        type: 'question'
      });
      
      console.log(`❓ Asked question ${sessionData.currentQuestionIndex}: ${question.substring(0, 50)}...`);
      
    } catch (error) {
      console.error('❌ Error asking next question:', error);
    }
  }

  /**
   * Generate response feedback using the selected provider
   */
  async generateResponseFeedback(question, response, config) {
    try {
      const prompt = `As an AI interviewer, provide brief, encouraging feedback (1-2 sentences) for this interview response:

Question: "${question}"
Response: "${response}"
Interview Context: ${config.style} interview for ${config.topic}, ${config.experienceLevel} level

Provide constructive, positive feedback that acknowledges their response and transitions to the next question. Keep it conversational and encouraging.`;

      let feedback;

      if (this.provider === 'google' && this.geminiModel) {
        const result = await this.geminiModel.generateContent(prompt);
        feedback = result.response.text().trim();
      } else {
        // Use the existing LLM service as fallback
        const messages = [{ role: 'user', content: prompt }];
        feedback = await this.llmService.makeAPICall(messages);
      }
      
      return feedback;
      
    } catch (error) {
      console.error(`❌ Error generating feedback with ${this.provider}:`, error);
      return "Thank you for that response. Let's move on to the next question.";
    }
  }

  /**
   * Pre-generate questions for better performance
   */
  async preGenerateQuestions(sessionData, count = 3) {
    try {
      console.log(`🔄 Pre-generating ${count} questions for session ${sessionData.sessionId}`);
      
      for (let i = 0; i < count; i++) {
        const question = await this.llmService.generateQuestion({
          config: sessionData.config,
          previousQuestions: sessionData.questions,
          previousResponses: sessionData.responses,
          questionNumber: i + 1
        });
        
        sessionData.questions.push(question);
        console.log(`✅ Pre-generated question ${i + 1}: ${question.substring(0, 50)}...`);
      }
      
    } catch (error) {
      console.error('❌ Error pre-generating questions:', error);
    }
  }

  /**
   * Generate next question
   */
  async generateNextQuestion(sessionData) {
    try {
      const question = await this.llmService.generateQuestion({
        config: sessionData.config,
        previousQuestions: sessionData.questions,
        previousResponses: sessionData.responses,
        questionNumber: sessionData.currentQuestionIndex + 1
      });
      
      console.log(`🆕 Generated new question: ${question.substring(0, 50)}...`);
      return question;
      
    } catch (error) {
      console.error('❌ Error generating question:', error);
      return "Can you tell me about your experience with this technology?";
    }
  }

  /**
   * Check if interview should continue
   */
  shouldContinueInterview(sessionData) {
    const timeElapsed = Date.now() - sessionData.startTime;
    const maxDuration = sessionData.config.duration * 60 * 1000;
    const maxQuestions = Math.min(Math.max(3, Math.floor(sessionData.config.duration / 5)), 10);
    
    return sessionData.status === 'interviewing' && 
           timeElapsed < maxDuration && 
           sessionData.currentQuestionIndex < maxQuestions;
  }

  /**
   * End the interview
   */
  async endInterview(sessionData) {
    sessionData.status = 'completed';
    sessionData.endTime = Date.now();
    
    const providerName = this.provider === 'openai' ? 'OpenAI' : 'Google AI';
    const closingMessage = `Thank you for completing the interview with ${providerName}! You did a great job. I'll now generate your detailed analytics and feedback.`;
    await this.speakText(closingMessage, sessionData);
    
    sessionData.conversationHistory.push({
      speaker: 'ai',
      message: closingMessage,
      timestamp: Date.now(),
      type: 'feedback'
    });
    
    console.log(`✅ Interview completed for session: ${sessionData.sessionId} using ${this.provider.toUpperCase()}`);
  }

  /**
   * Get session statistics
   */
  getSessionStats(sessionId) {
    const session = this.interviewSessions.get(sessionId);
    if (!session) return null;
    
    return {
      sessionId,
      status: session.status,
      provider: session.provider,
      questionsAsked: session.currentQuestionIndex,
      responsesReceived: session.responses.length,
      duration: Date.now() - session.startTime,
      config: session.config,
      conversationHistory: session.conversationHistory
    };
  }
}

// Create and export the agent
const multiProviderAgent = new MultiProviderAIInterviewAgent();
export const agent = multiProviderAgent.createAgent();

// CLI entry point for running the agent
if (import.meta.url === `file://${process.argv[1]}`) {
  cli.runApp(new WorkerOptions({
    agent,
    logLevel: 'info'
  }));
}