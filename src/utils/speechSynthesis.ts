export interface SpeechOptions {
  rate?: number;
  pitch?: number;
  volume?: number;
  voice?: SpeechSynthesisVoice | null;
  lang?: string;
}

export interface SpeechResult {
  success: boolean;
  error?: string;
}

export class BrowserTTS {
  private synthesis: SpeechSynthesis | null = null;
  private voices: SpeechSynthesisVoice[] = [];
  private isSupported: boolean = false;
  private currentUtterance: SpeechSynthesisUtterance | null = null;

  constructor() {
    this.initialize();
  }

  private initialize(): void {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.synthesis = window.speechSynthesis;
      this.isSupported = true;
      this.loadVoices();
      
      // Listen for voices changed event (some browsers load voices asynchronously)
      if (this.synthesis) {
        this.synthesis.addEventListener('voiceschanged', () => {
          this.loadVoices();
        });
      }
    }
  }

  private loadVoices(): void {
    if (this.synthesis) {
      this.voices = this.synthesis.getVoices();
      console.log(`[BrowserTTS] Loaded ${this.voices.length} voices`);
    }
  }

  public getVoices(): SpeechSynthesisVoice[] {
    return this.voices;
  }

  public getPreferredVoice(lang: string = 'en-US'): SpeechSynthesisVoice | null {
    // Try to find a female voice first
    const femaleVoices = this.voices.filter(voice => 
      voice.lang.startsWith(lang.split('-')[0]) && (
        voice.name.toLowerCase().includes('female') ||
        voice.name.toLowerCase().includes('woman') ||
        voice.name.toLowerCase().includes('samantha') ||
        voice.name.toLowerCase().includes('karen') ||
        voice.name.toLowerCase().includes('zira') ||
        voice.name.toLowerCase().includes('susan') ||
        voice.name.toLowerCase().includes('allison')
      )
    );

    if (femaleVoices.length > 0) {
      return femaleVoices[0];
    }

    // Fallback to any voice matching the language
    const langVoices = this.voices.filter(voice => 
      voice.lang.startsWith(lang.split('-')[0])
    );

    if (langVoices.length > 0) {
      return langVoices[0];
    }

    // Final fallback to default voice
    return this.voices.length > 0 ? this.voices[0] : null;
  }

  public async speak(
    text: string, 
    options: SpeechOptions = {},
    onStart?: () => void,
    onEnd?: () => void,
    onError?: (error: string) => void
  ): Promise<SpeechResult> {
    if (!this.isSupported || !this.synthesis) {
      const error = 'Speech synthesis not supported in this browser';
      onError?.(error);
      return { success: false, error };
    }

    // Cancel any ongoing speech
    this.stop();

    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      
      // Set options
      utterance.rate = options.rate ?? 0.9;
      utterance.pitch = options.pitch ?? 1.0;
      utterance.volume = options.volume ?? 1.0;
      utterance.lang = options.lang ?? 'en-US';
      
      // Set voice
      if (options.voice) {
        utterance.voice = options.voice;
      } else {
        const preferredVoice = this.getPreferredVoice(utterance.lang);
        if (preferredVoice) {
          utterance.voice = preferredVoice;
        }
      }

      // Set up event handlers
      utterance.onstart = () => {
        console.log('[BrowserTTS] Speech started');
        onStart?.();
      };

      utterance.onend = () => {
        console.log('[BrowserTTS] Speech ended');
        this.currentUtterance = null;
        onEnd?.();
        resolve({ success: true });
      };

      utterance.onerror = (event) => {
        console.error('[BrowserTTS] Speech error:', event.error);
        this.currentUtterance = null;
        const errorMessage = `Speech synthesis error: ${event.error}`;
        onError?.(errorMessage);
        resolve({ success: false, error: errorMessage });
      };

      utterance.onpause = () => {
        console.log('[BrowserTTS] Speech paused');
      };

      utterance.onresume = () => {
        console.log('[BrowserTTS] Speech resumed');
      };

      // Store current utterance
      this.currentUtterance = utterance;

      // Start speaking
      try {
        this.synthesis!.speak(utterance);
        console.log(`[BrowserTTS] Speaking: "${text.substring(0, 50)}..."`);
      } catch (error) {
        const errorMessage = `Failed to start speech: ${error}`;
        console.error('[BrowserTTS]', errorMessage);
        onError?.(errorMessage);
        resolve({ success: false, error: errorMessage });
      }
    });
  }

  public stop(): void {
    if (this.synthesis && this.currentUtterance) {
      this.synthesis.cancel();
      this.currentUtterance = null;
      console.log('[BrowserTTS] Speech stopped');
    }
  }

  public pause(): void {
    if (this.synthesis && this.currentUtterance) {
      this.synthesis.pause();
      console.log('[BrowserTTS] Speech paused');
    }
  }

  public resume(): void {
    if (this.synthesis && this.currentUtterance) {
      this.synthesis.resume();
      console.log('[BrowserTTS] Speech resumed');
    }
  }

  public isSpeaking(): boolean {
    return this.synthesis ? this.synthesis.speaking : false;
  }

  public isPaused(): boolean {
    return this.synthesis ? this.synthesis.paused : false;
  }

  public isSupported(): boolean {
    return this.isSupported;
  }

  public getStatus(): {
    supported: boolean;
    speaking: boolean;
    paused: boolean;
    voicesCount: number;
    preferredVoice: string | null;
  } {
    const preferredVoice = this.getPreferredVoice();
    
    return {
      supported: this.isSupported,
      speaking: this.isSpeaking(),
      paused: this.isPaused(),
      voicesCount: this.voices.length,
      preferredVoice: preferredVoice ? preferredVoice.name : null
    };
  }
}

// Create a singleton instance
export const browserTTS = new BrowserTTS();