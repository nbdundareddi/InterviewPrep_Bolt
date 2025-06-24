import { InterviewConfig, Question, AnalyticsData, InterviewResponse } from '../types';
import { APIService } from '../services/apiService';
import { browserTTS } from './speechSynthesis';

export class AIInterviewSimulator {
  private config: InterviewConfig;
  private currentQuestionIndex: number;
  private startTime: number;
  private responses: InterviewResponse[];
  private generatedQuestions: string[];
  private isUsingLLM: boolean;
  private nextQuestionCache: string | null = null;
  private isInterviewEnded: boolean = false;
  private enableTTS: boolean = false;
  private onTTSStart?: () => void;
  private onTTSEnd?: () => void;

  constructor(config: InterviewConfig, enableTTS: boolean = false) {
    this.config = config;
    this.currentQuestionIndex = 0;
    this.startTime = Date.now();
    this.responses = [];
    this.generatedQuestions = [];
    this.isUsingLLM = true;
    this.nextQuestionCache = null;
    this.isInterviewEnded = false;
    this.enableTTS = enableTTS;
  }

  /**
   * Set TTS event handlers
   */
  setTTSHandlers(onStart?: () => void, onEnd?: () => void): void {
    this.onTTSStart = onStart;
    this.onTTSEnd = onEnd;
  }

  /**
   * Enable or disable TTS
   */
  setTTSEnabled(enabled: boolean): void {
    this.enableTTS = enabled;
    if (!enabled) {
      browserTTS.stop();
    }
  }

  /**
   * Speak a question using browser TTS
   */
  private async speakQuestion(question: string): Promise<void> {
    if (!this.enableTTS || !browserTTS.isSupported()) {
      return;
    }

    try {
      console.log('[AISimulator] Speaking question with browser TTS');
      
      await browserTTS.speak(
        question,
        {
          rate: 0.9,
          pitch: 1.0,
          volume: 1.0,
          lang: 'en-US'
        },
        () => {
          console.log('[AISimulator] TTS started');
          this.onTTSStart?.();
        },
        () => {
          console.log('[AISimulator] TTS ended');
          this.onTTSEnd?.();
        },
        (error) => {
          console.error('[AISimulator] TTS error:', error);
        }
      );
    } catch (error) {
      console.error('[AISimulator] Error speaking question:', error);
    }
  }

  async getNextQuestion(): Promise<string | null> {
    try {
      // Check if interview has been manually ended
      if (this.isInterviewEnded) {
        console.log('🏁 Interview has been manually ended');
        return null;
      }

      // Calculate maximum questions based on duration with proper scaling
      const maxQuestions = this.calculateMaxQuestions();
      console.log(`📊 Question ${this.currentQuestionIndex + 1} of ${maxQuestions} (Duration: ${this.config.duration} minutes)`);

      if (this.currentQuestionIndex >= maxQuestions) {
        console.log('🏁 Reached maximum questions for duration');
        return null;
      }

      // Check time limit (with some buffer for completion)
      const timeElapsed = Date.now() - this.startTime;
      const maxDuration = this.config.duration * 60 * 1000; // Convert to milliseconds
      const timeBuffer = 2 * 60 * 1000; // 2 minute buffer for completion
      
      if (timeElapsed > (maxDuration + timeBuffer)) {
        console.log('⏰ Time limit exceeded');
        return null;
      }

      let question: string | null = null;

      // Use cached question if available
      if (this.nextQuestionCache) {
        console.log('✅ Using cached next question');
        question = this.nextQuestionCache;
        this.nextQuestionCache = null;
        this.generatedQuestions.push(question);
      } else if (this.isUsingLLM) {
        console.log('🤖 Requesting question from agentic framework...');
        const startTime = Date.now();
        
        try {
          question = await APIService.generateQuestion({
            config: this.config,
            previousQuestions: this.generatedQuestions,
            previousResponses: this.responses,
            questionNumber: this.currentQuestionIndex + 1
          });

          const duration = Date.now() - startTime;
          console.log(`✅ Agentic question received in ${duration}ms`);

          this.generatedQuestions.push(question);
          
          // Pre-generate next question in background if not the last question
          this.preGenerateNextQuestion();
        } catch (error) {
          console.error('❌ Error getting question from agentic framework:', error);
          console.log('🔄 Falling back to predefined questions with TTS');
          this.isUsingLLM = false;
          question = this.getFallbackQuestion();
        }
      } else {
        // Fallback to predefined questions
        question = this.getFallbackQuestion();
      }

      // Speak the question if TTS is enabled and we have a question
      if (question && this.enableTTS) {
        // Don't await this - let it run in parallel
        this.speakQuestion(question).catch(error => {
          console.error('Error speaking question:', error);
        });
      }
      
      return question;
    } catch (error) {
      console.error('❌ Error in getNextQuestion:', error);
      console.log('🔄 Falling back to predefined questions with TTS');
      // Fallback to predefined questions if LLM fails
      this.isUsingLLM = false;
      const fallbackQuestion = this.getFallbackQuestion();
      
      // Speak fallback question if TTS is enabled
      if (fallbackQuestion && this.enableTTS) {
        this.speakQuestion(fallbackQuestion).catch(error => {
          console.error('Error speaking fallback question:', error);
        });
      }
      
      return fallbackQuestion;
    }
  }

  /**
   * Calculate maximum questions based on duration with proper scaling
   */
  private calculateMaxQuestions(): number {
    // More sophisticated calculation based on duration
    // Assumes roughly 3-8 minutes per question depending on complexity and experience level
    
    let timePerQuestion = 5; // Default 5 minutes per question
    
    // Adjust based on experience level
    switch (this.config.experienceLevel) {
      case 'fresher':
        timePerQuestion = 4; // Shorter questions for beginners
        break;
      case 'junior':
        timePerQuestion = 5;
        break;
      case 'mid-level':
        timePerQuestion = 6;
        break;
      case 'senior':
        timePerQuestion = 7; // More complex questions
        break;
      case 'lead-manager':
        timePerQuestion = 8; // Most complex questions
        break;
    }
    
    // Adjust based on interview style
    switch (this.config.style) {
      case 'technical':
        timePerQuestion += 1; // Technical questions take longer
        break;
      case 'case-study':
        timePerQuestion += 2; // Case studies take much longer
        break;
      case 'behavioral':
        timePerQuestion += 0.5; // Behavioral questions are moderate
        break;
      case 'hr':
        timePerQuestion -= 0.5; // HR questions are typically shorter
        break;
      case 'salary-negotiation':
        timePerQuestion -= 1; // Negotiation questions are shorter
        break;
    }
    
    const calculatedQuestions = Math.floor(this.config.duration / timePerQuestion);
    
    // Ensure reasonable bounds
    const minQuestions = 3;
    const maxQuestions = Math.min(15, Math.max(8, Math.floor(this.config.duration / 3))); // Cap at 15, but allow more for longer durations
    
    const finalCount = Math.max(minQuestions, Math.min(maxQuestions, calculatedQuestions));
    
    return finalCount;
  }

  /**
   * Pre-generate the next question in the background for faster response
   */
  private async preGenerateNextQuestion(): Promise<void> {
    try {
      const maxQuestions = this.calculateMaxQuestions();

      // Only pre-generate if there will be a next question
      if (this.currentQuestionIndex + 1 < maxQuestions && this.isUsingLLM && !this.isInterviewEnded) {
        console.log('🔄 Pre-generating next question in background...');
        
        // Don't await this - let it run in background
        APIService.generateQuestion({
          config: this.config,
          previousQuestions: this.generatedQuestions,
          previousResponses: this.responses,
          questionNumber: this.currentQuestionIndex + 2
        }).then(question => {
          if (!this.isInterviewEnded) { // Only cache if interview hasn't ended
            this.nextQuestionCache = question;
            console.log('✅ Next question pre-generated and cached');
          }
        }).catch(error => {
          console.error('❌ Pre-generation failed:', error);
          // Don't set cache on failure
        });
      }
    } catch (error) {
      console.error('❌ Error in pre-generation:', error);
    }
  }

  private getFallbackQuestion(): string | null {
    const fallbackQuestions = {
      technical: [
        "Explain the difference between synchronous and asynchronous programming.",
        "How would you optimize the performance of a web application?",
        "Describe your approach to debugging a complex issue.",
        "What are the key principles of good software design?",
        "How do you ensure code quality in your projects?",
        "Explain the concept of design patterns and give examples.",
        "How do you handle error handling in your applications?",
        "Describe your experience with testing methodologies.",
        "What are the security considerations in web development?",
        "How do you approach code reviews and collaboration?",
        "Explain the importance of documentation in software development.",
        "How do you stay updated with new technologies and trends?",
        "Describe your experience with version control systems.",
        "What are the best practices for database design?",
        "How do you approach performance monitoring and optimization?"
      ],
      hr: [
        "Tell me about yourself and your career goals.",
        "Why are you interested in this position?",
        "How do you handle working under pressure?",
        "What motivates you in your work?",
        "Where do you see yourself in 5 years?",
        "Describe your ideal work environment.",
        "How do you handle feedback and criticism?",
        "What are your greatest strengths and weaknesses?",
        "Why are you looking to leave your current position?",
        "How do you prioritize work-life balance?",
        "What type of management style works best for you?",
        "How do you handle conflicts with colleagues?",
        "What are your salary expectations?",
        "How do you continue learning and developing professionally?",
        "What questions do you have about our company?"
      ],
      behavioral: [
        "Tell me about a challenging project you worked on.",
        "Describe a time when you had to work with a difficult team member.",
        "Give me an example of when you had to learn something new quickly.",
        "Tell me about a time you failed and how you handled it.",
        "Describe a situation where you had to make a difficult decision.",
        "Tell me about a time you had to meet a tight deadline.",
        "Describe a situation where you had to persuade someone.",
        "Give me an example of when you showed leadership.",
        "Tell me about a time you had to adapt to change.",
        "Describe a situation where you went above and beyond.",
        "Tell me about a time you had to handle multiple priorities.",
        "Describe a situation where you had to work with limited resources.",
        "Give me an example of when you took initiative.",
        "Tell me about a time you had to give difficult feedback.",
        "Describe a situation where you had to solve a complex problem."
      ],
      'salary-negotiation': [
        "What are your salary expectations for this role?",
        "How do you evaluate the total compensation package?",
        "What factors are most important to you besides salary?",
        "How flexible are you with your compensation requirements?",
        "What would make you accept an offer below your expectations?",
        "How do you research market rates for your position?",
        "What benefits are most valuable to you?",
        "How do you approach negotiating equity or stock options?",
        "What's your timeline for making a decision on an offer?",
        "How do you balance salary with career growth opportunities?"
      ],
      'case-study': [
        "How would you approach designing a system for handling high traffic?",
        "Walk me through how you would solve a performance issue.",
        "Describe your process for making technical decisions.",
        "How would you handle a critical production incident?",
        "What's your approach to evaluating new technologies?",
        "How would you design a scalable database architecture?",
        "Describe how you would implement a caching strategy.",
        "How would you approach migrating a legacy system?",
        "What's your process for conducting a technical audit?",
        "How would you design a monitoring and alerting system?",
        "Describe your approach to capacity planning.",
        "How would you implement a disaster recovery plan?",
        "What's your strategy for managing technical debt?",
        "How would you approach API design and versioning?",
        "Describe your process for security assessment and implementation."
      ]
    };
    
    const questions = fallbackQuestions[this.config.style] || fallbackQuestions.technical;
    
    if (this.currentQuestionIndex >= questions.length) {
      console.log('🏁 Exhausted all fallback questions');
      return null;
    }

    const question = questions[this.currentQuestionIndex];
    console.log(`📝 Using fallback question ${this.currentQuestionIndex + 1} with TTS support`);
    return question;
  }

  async submitResponse(response: string): Promise<void> {
    const currentQuestion = this.generatedQuestions[this.currentQuestionIndex] || 
                           this.getFallbackQuestion();
    
    if (!currentQuestion) return;

    const responseData: InterviewResponse = {
      questionId: `q${this.currentQuestionIndex + 1}`,
      question: currentQuestion,
      response,
      timestamp: Date.now(),
      duration: Date.now() - this.startTime
    };

    this.responses.push(responseData);
    this.currentQuestionIndex++;

    // Skip real-time response analysis to improve performance
    // Analysis will be done comprehensively at the end
    console.log('📝 Response submitted, skipping real-time analysis for better performance');
  }

  async generateFollowUp(previousResponse: string): Promise<string | null> {
    if (!this.isUsingLLM) return null;

    try {
      const currentQuestion = this.generatedQuestions[this.currentQuestionIndex - 1];
      if (!currentQuestion) return null;

      const followUp = await APIService.generateFollowUp({
        question: currentQuestion,
        response: previousResponse,
        config: this.config
      });

      // Speak follow-up if TTS is enabled
      if (followUp && this.enableTTS) {
        this.speakQuestion(followUp).catch(error => {
          console.error('Error speaking follow-up question:', error);
        });
      }

      return followUp;
    } catch (error) {
      console.error('Error generating follow-up:', error);
      return null;
    }
  }

  /**
   * Stop any ongoing TTS
   */
  stopTTS(): void {
    browserTTS.stop();
  }

  /**
   * Get TTS status
   */
  getTTSStatus() {
    return browserTTS.getStatus();
  }

  isInterviewComplete(): boolean {
    if (this.isInterviewEnded) {
      return true;
    }
    
    const maxQuestions = this.calculateMaxQuestions();
    const timeElapsed = Date.now() - this.startTime;
    const maxDuration = this.config.duration * 60 * 1000;
    
    return this.currentQuestionIndex >= maxQuestions || timeElapsed > maxDuration;
  }

  /**
   * Manually end the interview early
   */
  endInterviewEarly(): void {
    console.log('🛑 Interview ended early by user');
    this.isInterviewEnded = true;
    this.nextQuestionCache = null; // Clear any cached questions
    this.stopTTS(); // Stop any ongoing speech
  }

  /**
   * Check if interview was ended early
   */
  wasEndedEarly(): boolean {
    const maxQuestions = this.calculateMaxQuestions();
    return this.isInterviewEnded && this.currentQuestionIndex < maxQuestions;
  }

  getProgress(): { current: number; total: number; percentage: number } {
    const maxQuestions = this.calculateMaxQuestions();
    const current = Math.min(this.currentQuestionIndex + 1, maxQuestions);
    const percentage = (current / maxQuestions) * 100;
    
    return { current, total: maxQuestions, percentage };
  }

  async generateAnalytics(): Promise<AnalyticsData> {
    if (this.isUsingLLM && this.responses.length > 0) {
      try {
        console.log('🧠 Starting comprehensive agentic analytics generation...');
        const startTime = Date.now();
        
        const analytics = await APIService.generateAnalytics({
          responses: this.responses,
          config: this.config
        });
        
        const duration = Date.now() - startTime;
        console.log(`✅ Agentic analytics completed in ${duration}ms`);
        
        // Add early termination info to metadata
        if (analytics.metadata) {
          analytics.metadata.wasEndedEarly = this.wasEndedEarly();
          analytics.metadata.completionRate = (this.responses.length / this.calculateMaxQuestions()) * 100;
        }
        
        return analytics;
      } catch (error) {
        console.error('Error generating LLM analytics:', error);
      }
    }

    // Fallback analytics
    return this.generateFallbackAnalytics();
  }

  private generateFallbackAnalytics(): AnalyticsData {
    const totalResponses = this.responses.length;
    
    const responseAnalysis = {
      clarity: this.calculateClarityScore(),
      structure: this.calculateStructureScore(),
      technical: this.calculateTechnicalScore(),
      communication: this.calculateCommunicationScore(),
      confidence: this.calculateConfidenceScore()
    };

    const overallScore = Math.round(
      Object.values(responseAnalysis).reduce((sum, score) => sum + score, 0) / 5
    );

    const strengths = this.generateStrengths(responseAnalysis);
    const improvements = this.generateImprovements(responseAnalysis);
    const questionReviews = this.generateQuestionReviews();

    return {
      overallScore,
      strengths,
      improvements,
      responseAnalysis,
      questionReviews,
      metadata: {
        generatedAt: new Date().toISOString(),
        analysisMethod: 'fallback',
        totalResponses: this.responses.length,
        wasEndedEarly: this.wasEndedEarly(),
        completionRate: (this.responses.length / this.calculateMaxQuestions()) * 100,
        maxQuestionsCalculated: this.calculateMaxQuestions(),
        ttsEnabled: this.enableTTS,
        ttsSupported: browserTTS.isSupported()
      }
    };
  }

  private calculateClarityScore(): number {
    const avgLength = this.responses.reduce((sum, r) => sum + r.response.length, 0) / this.responses.length;
    const clarityScore = Math.min(95, Math.max(60, 70 + (avgLength / 50)));
    return Math.round(clarityScore);
  }

  private calculateStructureScore(): number {
    const structureKeywords = ['first', 'second', 'third', 'because', 'therefore', 'however', 'additionally'];
    let structuredResponses = 0;

    this.responses.forEach(response => {
      const hasStructure = structureKeywords.some(keyword => 
        response.response.toLowerCase().includes(keyword)
      );
      if (hasStructure) structuredResponses++;
    });

    const structureScore = Math.round(65 + (structuredResponses / this.responses.length) * 30);
    return Math.min(95, structureScore);
  }

  private calculateTechnicalScore(): number {
    if (this.config.style !== 'technical') return 75;

    const technicalKeywords = ['function', 'variable', 'class', 'method', 'algorithm', 'data structure', 'performance', 'optimization'];
    let technicalResponses = 0;

    this.responses.forEach(response => {
      const hasTechnical = technicalKeywords.some(keyword => 
        response.response.toLowerCase().includes(keyword)
      );
      if (hasTechnical) technicalResponses++;
    });

    const technicalScore = Math.round(60 + (technicalResponses / this.responses.length) * 35);
    return Math.min(95, technicalScore);
  }

  private calculateCommunicationScore(): number {
    const avgResponseLength = this.responses.reduce((sum, r) => sum + r.response.length, 0) / this.responses.length;
    const communicationScore = Math.min(95, Math.max(55, 65 + (avgResponseLength / 40)));
    return Math.round(communicationScore);
  }

  private calculateConfidenceScore(): number {
    const confidenceIndicators = ['definitely', 'certainly', 'confident', 'sure', 'absolutely', 'clearly'];
    const uncertaintyIndicators = ['maybe', 'perhaps', 'might', 'not sure', 'think', 'probably'];
    
    let confidencePoints = 0;
    this.responses.forEach(response => {
      const text = response.response.toLowerCase();
      confidenceIndicators.forEach(indicator => {
        if (text.includes(indicator)) confidencePoints += 2;
      });
      uncertaintyIndicators.forEach(indicator => {
        if (text.includes(indicator)) confidencePoints -= 1;
      });
    });

    const baseScore = 70;
    const confidenceScore = Math.max(45, Math.min(95, baseScore + confidencePoints * 2));
    return Math.round(confidenceScore);
  }

  private generateStrengths(analysis: any): string[] {
    const strengths = [];
    
    if (analysis.clarity >= 80) strengths.push("Clear and articulate communication");
    if (analysis.structure >= 80) strengths.push("Well-structured responses using logical flow");
    if (analysis.technical >= 80) strengths.push("Strong technical knowledge and accuracy");
    if (analysis.communication >= 80) strengths.push("Excellent communication skills");
    if (analysis.confidence >= 80) strengths.push("Confident and decisive responses");
    
    // Add completion-based strengths
    const completionRate = (this.responses.length / this.calculateMaxQuestions()) * 100;
    if (completionRate >= 80) {
      strengths.push("Completed most of the interview successfully");
    }
    
    return strengths.length > 0 ? strengths : ["Shows enthusiasm and willingness to learn"];
  }

  private generateImprovements(analysis: any): string[] {
    const improvements = [];
    
    if (analysis.clarity < 70) improvements.push("Work on articulating thoughts more clearly and concisely");
    if (analysis.structure < 70) improvements.push("Structure responses using frameworks like STAR method");
    if (analysis.technical < 70) improvements.push("Strengthen technical knowledge in core areas");
    if (analysis.communication < 70) improvements.push("Practice active listening and more engaging responses");
    if (analysis.confidence < 70) improvements.push("Build confidence through more practice and preparation");
    
    // Add completion-based improvements
    if (this.wasEndedEarly()) {
      improvements.push("Consider completing full interview sessions for comprehensive practice");
    }
    
    return improvements.length > 0 ? improvements : ["Continue practicing interview scenarios"];
  }

  private generateQuestionReviews() {
    return this.responses.map((response, index) => {
      const score = Math.round(60 + Math.random() * 35);
      
      const feedbacks = [
        "Good response with relevant examples. Consider adding more specific details.",
        "Well-structured answer. Could benefit from mentioning potential challenges.",
        "Solid understanding shown. Try to explain concepts more simply.",
        "Great use of specific examples. Consider discussing lessons learned.",
        "Clear communication demonstrated. Could explore alternative approaches."
      ];

      return {
        questionId: response.questionId,
        question: response.question,
        response: response.response,
        score,
        feedback: feedbacks[Math.floor(Math.random() * feedbacks.length)]
      };
    });
  }

  // Add method to check if using LLM
  isUsingAgentic(): boolean {
    return this.isUsingLLM;
  }

  // Add method to force fallback mode
  forceFallbackMode(): void {
    console.log('🔄 Forcing fallback mode');
    this.isUsingLLM = false;
    this.nextQuestionCache = null; // Clear any cached questions
  }

  // Add method to get performance stats
  getPerformanceStats() {
    return {
      isUsingLLM: this.isUsingLLM,
      questionsGenerated: this.generatedQuestions.length,
      responsesSubmitted: this.responses.length,
      hasCachedQuestion: !!this.nextQuestionCache,
      currentQuestionIndex: this.currentQuestionIndex,
      maxQuestions: this.calculateMaxQuestions(),
      isInterviewEnded: this.isInterviewEnded,
      wasEndedEarly: this.wasEndedEarly(),
      completionRate: (this.responses.length / this.calculateMaxQuestions()) * 100,
      ttsEnabled: this.enableTTS,
      ttsStatus: this.getTTSStatus()
    };
  }
}