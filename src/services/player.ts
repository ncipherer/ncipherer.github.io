
export interface Track {
  title: string;
  artist: string;
  videoId: string;
}

export class MusicPlayerService {
  private static instance: MusicPlayerService;
  private player: any = null;
  private queue: Track[] = [];
  private currentIndex: number = -1;
  private playerContainer: HTMLDivElement | null = null;
  private isInitialized: boolean = false;
  private pendingPlay: { tracks: Track[], index: number } | null = null;

  private constructor() {}

  public static getInstance(): MusicPlayerService {
    if (!MusicPlayerService.instance) {
      MusicPlayerService.instance = new MusicPlayerService();
    }
    return MusicPlayerService.instance;
  }

  public init(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // 1. Inject YouTube API
    const tag = document.createElement('script');
    tag.src = "https://www.youtube.com/iframe_api";
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);

    // 2. Setup global callback
    (window as any).onYouTubeIframeAPIReady = () => {
      this.createPlayer();
    };

    // 3. Create UI container
    this.createUI();
  }

  private createPlayer(): void {
    const playerDiv = document.createElement('div');
    playerDiv.id = 'yt-background-player';
    playerDiv.style.position = 'absolute';
    playerDiv.style.top = '-9999px';
    playerDiv.style.left = '-9999px';
    playerDiv.style.width = '1px';
    playerDiv.style.height = '1px';
    document.body.appendChild(playerDiv);

    if (this.player) return;

    this.player = new (window as any).YT.Player('yt-background-player', {
      height: '1',
      width: '1',
      playerVars: {
        'autoplay': 0,
        'controls': 0,
        'showinfo': 0,
        'rel': 0,
        'modestbranding': 1,
        'origin': window.location.origin
      },
      events: {
        'onReady': () => {
          if (this.pendingPlay) {
            this.playQueue(this.pendingPlay.tracks, this.pendingPlay.index);
            this.pendingPlay = null;
          }
        },
        'onStateChange': (event: any) => this.onPlayerStateChange(event),
        'onError': (event: any) => this.onPlayerError(event)
      }
    });
  }

  private createUI(): void {
    this.playerContainer = document.createElement('div');
    this.playerContainer.id = 'music-player-bar';
    this.playerContainer.className = 'music-player-bar hidden';
    
    this.playerContainer.innerHTML = `
      <div class="mp-content">
        <div class="mp-info">
          <div class="mp-title">Not playing</div>
          <div class="mp-artist">Select a song</div>
        </div>
        <div class="mp-controls">
          <button class="mp-btn prev" aria-label="Previous">⏮</button>
          <button class="mp-btn play-pause" aria-label="Play/Pause">▶</button>
          <button class="mp-btn next" aria-label="Next">⏭</button>
        </div>
        <button class="mp-btn close" aria-label="Close player">×</button>
      </div>
      <div class="mp-progress-container">
        <div class="mp-progress-bar"></div>
      </div>
    `;

    document.body.appendChild(this.playerContainer);

    // Event listeners
    this.playerContainer.querySelector('.play-pause')?.addEventListener('click', () => this.togglePlay());
    this.playerContainer.querySelector('.next')?.addEventListener('click', () => this.next());
    this.playerContainer.querySelector('.prev')?.addEventListener('click', () => this.prev());
    this.playerContainer.querySelector('.close')?.addEventListener('click', () => this.hide());
    
    // Progress bar click
    this.playerContainer.querySelector('.mp-progress-container')?.addEventListener('click', (e: Event) => {
      const mouseEvent = e as MouseEvent;
      const container = mouseEvent.currentTarget as HTMLElement;
      const rect = container.getBoundingClientRect();
      const x = mouseEvent.clientX - rect.left;
      const percentage = x / rect.width;
      if (this.player && this.player.getDuration) {
        this.player.seekTo(this.player.getDuration() * percentage, true);
      }
    });

    // Progress is updated only while playing (called from onStateChange)
  }

  private rafId: number | null = null;

  private startProgressLoop(): void {
    if (this.rafId !== null) return;
    const loop = () => {
      this.updateProgress();
      if (this.player && this.player.getPlayerState &&
          this.player.getPlayerState() === (window as any).YT.PlayerState.PLAYING) {
        this.rafId = requestAnimationFrame(loop);
      } else {
        this.rafId = null;
      }
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private stopProgressLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private onPlayerStateChange(event: any): void {
    const playPauseBtn = this.playerContainer?.querySelector('.play-pause');
    if (event.data === (window as any).YT.PlayerState.PLAYING) {
      if (playPauseBtn) playPauseBtn.textContent = '⏸';
      this.updateTrackInfo();
      this.startProgressLoop();
    } else if (event.data === (window as any).YT.PlayerState.ENDED) {
      this.stopProgressLoop();
      this.next();
    } else {
      if (playPauseBtn) playPauseBtn.textContent = '▶';
      this.stopProgressLoop();
    }
  }

  private onPlayerError(event: any): void {
    console.error('YouTube Player Error:', event.data);
    this.next(); // Try playing next song on error
  }

  private lastProgressUpdate: number = 0;

  private updateProgress(): void {
    const now = performance.now();
    // Throttle to ~4 updates per second (every 250ms) to keep CPU low
    if (now - this.lastProgressUpdate < 250) return;
    this.lastProgressUpdate = now;

    if (!this.player || !this.player.getDuration) return;
    const duration = this.player.getDuration();
    if (duration > 0) {
      const current = this.player.getCurrentTime();
      const percent = (current / duration) * 100;
      const progressBar = this.playerContainer?.querySelector('.mp-progress-bar') as HTMLElement;
      if (progressBar) progressBar.style.width = `${percent}%`;
    }
  }

  private updateTrackInfo(): void {
    if (this.currentIndex >= 0 && this.currentIndex < this.queue.length) {
      const track = this.queue[this.currentIndex];
      const titleElem = this.playerContainer?.querySelector('.mp-title');
      const artistElem = this.playerContainer?.querySelector('.mp-artist');
      if (titleElem) titleElem.textContent = track.title;
      if (artistElem) artistElem.textContent = track.artist || 'Unknown Artist';
    }
  }

  public playQueue(tracks: Track[], startIndex: number = 0): void {
    if (!this.player || !this.player.loadVideoById) {
      this.pendingPlay = { tracks, index: startIndex };
      this.show();
      return;
    }
    this.queue = tracks;
    this.currentIndex = startIndex;
    this.show();
    this.playCurrent();
  }

  public playTrack(track: Track): void {
    // Check if track already in queue
    const index = this.queue.findIndex(t => t.videoId === track.videoId);
    if (index >= 0) {
      this.currentIndex = index;
    } else {
      this.queue = [track];
      this.currentIndex = 0;
    }
    this.show();
    this.playCurrent();
  }

  private playCurrent(): void {
    if (!this.player || this.currentIndex < 0 || this.currentIndex >= this.queue.length) return;
    
    const track = this.queue[this.currentIndex];
    this.player.loadVideoById(track.videoId);
    this.updateTrackInfo();
  }

  public togglePlay(): void {
    if (!this.player) return;
    const state = this.player.getPlayerState();
    if (state === (window as any).YT.PlayerState.PLAYING) {
      this.player.pauseVideo();
    } else {
      this.player.playVideo();
    }
  }

  public next(): void {
    if (this.currentIndex < this.queue.length - 1) {
      this.currentIndex++;
      this.playCurrent();
    }
  }

  public prev(): void {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this.playCurrent();
    }
  }

  public show(): void {
    this.playerContainer?.classList.remove('hidden');
  }

  public hide(): void {
    this.playerContainer?.classList.add('hidden');
    if (this.player) this.player.pauseVideo();
  }
}
