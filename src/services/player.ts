import type { Track } from "../types";
import { ClickAudio } from "./click-audio";
export type { Track };

/** Minimal escaping for text that goes back into the DOM as markup. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export class MusicPlayerService {
  private static instance: MusicPlayerService;
  private player: any = null;
  private queue: Track[] = [];
  private currentIndex: number = -1;
  private playerContainer: HTMLDivElement | null = null;
  private isInitialized: boolean = false;
  private pendingPlay: { tracks: Track[], index: number } | null = null;
  /** the list row of the song that is playing, for the highlight + the
   *  "scroll to now playing" button */
  private currentRow: HTMLElement | null = null;
  private scrollBtn: HTMLButtonElement | null = null;
  private volume: number = 0.8;
  private muted: boolean = false;
  private preMuteVolume: number = 0.8;
  /** The queue drawer: everything waiting behind the song on the air. */
  private queuePanel: HTMLElement | null = null;
  private queueList: HTMLElement | null = null;
  private queueBtn: HTMLButtonElement | null = null;
  private queueOpen: boolean = false;
  /** Index highlighted by the last queue render — used to detect a song change. */
  private renderedPlaying = -1;

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

    // Remembered listening level, so the site does not shout on every visit.
    try {
      const stored = parseFloat(localStorage.getItem("music-player-volume") || "");
      if (!isNaN(stored)) this.volume = Math.min(1, Math.max(0, stored));
    } catch { /* private browsing — defaults are fine */ }

    // The header's speaker is the site's own switch, music included: a player
    // coming up while the site is muted starts that way, and only the switch
    // turns it back on.
    if (ClickAudio.isMuted()) {
      this.muted = true;
      this.preMuteVolume = this.volume || 0.8;
    }

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
          if (this.player && this.player.setVolume) {
            // muted wins over the remembered level: silent means silent.
            this.player.setVolume(this.muted ? 0 : Math.round(this.volume * 100));
          }
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
          <button class="mp-btn mp-queue-btn" aria-label="Show queue" aria-expanded="false">☰<span class="mp-queue-count" hidden></span></button>
          <div class="mp-volume">
            <button class="mp-btn mp-vol-btn" aria-label="Mute"><span class="mp-vol-icon" aria-hidden="true">🔈</span></button>
            <input class="mp-volume-slider" type="range" min="0" max="100" step="1" aria-label="Volume">
          </div>
        </div>
        <button class="mp-btn close" aria-label="Close player">×</button>
      </div>
      <div class="mp-queue-panel hidden" role="dialog" aria-label="Play queue">
        <div class="mp-queue-header">
          <button class="mp-queue-toggle" type="button" aria-label="Hide queue">
            <span class="mp-queue-heading">Queue</span>
            <span class="mp-queue-total">0 songs</span>
            <span class="mp-queue-chevron" aria-hidden="true">▾</span>
          </button>
          <button class="mp-queue-clear" type="button">Clear</button>
          <button class="mp-btn mp-queue-close" type="button" aria-label="Close queue">×</button>
        </div>
        <ol class="mp-queue-list"></ol>
        <div class="mp-queue-empty">Nothing queued yet. Tap ⋯ on a song and choose “Add to queue”.</div>
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

    // Queue drawer
    this.queueBtn = this.playerContainer.querySelector<HTMLButtonElement>('.mp-queue-btn');
    this.queuePanel = this.playerContainer.querySelector<HTMLElement>('.mp-queue-panel');
    this.queueList = this.playerContainer.querySelector<HTMLElement>('.mp-queue-list');
    this.queueBtn?.addEventListener('click', () => this.toggleQueue());
    // Clicking the drawer's header folds it away too, like a tray you push back down.
    this.queuePanel?.querySelector('.mp-queue-toggle')?.addEventListener('click', () => this.toggleQueue(false));
    this.queuePanel?.querySelector('.mp-queue-close')?.addEventListener('click', () => this.toggleQueue(false));
    this.queuePanel?.querySelector('.mp-queue-clear')?.addEventListener('click', () => this.clearQueue());
    this.queueList?.addEventListener('click', (e) => this.onQueueListClick(e));

    // Volume: the button is a mute toggle, the slider is the level itself.
    const volBtn = this.playerContainer.querySelector<HTMLButtonElement>('.mp-vol-btn');
    const volSlider = this.playerContainer.querySelector<HTMLInputElement>('.mp-volume-slider');
    if (volBtn) {
      volBtn.addEventListener('click', () => this.toggleMute());
    }
    if (volSlider) {
      volSlider.value = String(Math.round(this.volume * 100));
      this.paintVolumeSlider();
      volSlider.addEventListener('input', () => {
        const v = (parseInt(volSlider.value, 10) || 0) / 100;
        this.muted = false;
        this.setVolume(v);
        this.updateVolumeIcon();
      });
    }
    this.updateVolumeIcon();

    // The bar's own speaker follows the same state as the header's, so the
    // two controls can never end up disagreeing about whether sound is on.
    document.addEventListener("site-mute-change", (event) => {
      this.setMuted(!!(event as CustomEvent<{ muted?: boolean }>).detail?.muted);
    });

    // The bar stays collapsed and hidden until the reader actually plays
    // something — a fresh page never opens with a player on it.

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

    this.createScrollButton();

    // The "scroll to now playing" button follows the reader: it shows while a
    // song plays and its row has scrolled out of sight, and hides when the row
    // is back on screen.
    window.addEventListener("scroll", () => this.updateScrollBtnVisibility(), { passive: true });
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

  /**
   * Mark the list row of the song on the air. The row is found by video id,
   * so a highlight survives even when the songs page has been re-rendered.
   */
  private setPlayingRow(): void {
    const track = this.queue[this.currentIndex];
    const videoId = track ? track.videoId : "";
    document.querySelectorAll(".song-list-item.playing").forEach((el) => el.classList.remove("playing"));
    this.currentRow = videoId
      ? document.querySelector<HTMLElement>(`.song-list-item[data-video-id="${videoId}"]`)
      : null;
    this.currentRow?.classList.add("playing");
    this.updateScrollBtnVisibility();
  }

  // ── Scroll to now playing ─────────────────────────────────────────────
  private createScrollButton(): void {
    this.scrollBtn = document.createElement('button');
    this.scrollBtn.type = 'button';
    this.scrollBtn.className = 'mp-scroll-now';
    this.scrollBtn.innerHTML = `<span class="mp-scroll-arrow" aria-hidden="true">↑</span> Now playing`;
    this.scrollBtn.setAttribute('aria-label', 'Scroll to now playing');
    this.scrollBtn.addEventListener('click', () => this.scrollToCurrent());
    document.body.appendChild(this.scrollBtn);
  }

  private scrollToCurrent(): void {
    if (!this.currentRow || !this.currentRow.isConnected) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.currentRow.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "center",
    });
    // One pulse so the eye lands on the right row even in a long list.
    this.currentRow.classList.add("flash");
    window.setTimeout(() => this.currentRow?.classList.remove("flash"), 1600);
  }

  private updateScrollBtnVisibility(): void {
    if (!this.scrollBtn) return;
    const rowVisible =
      !!this.currentRow &&
      this.currentRow.isConnected &&
      !this.playerContainer?.classList.contains("hidden");
    const offscreen = rowVisible
      ? this.currentRow!.getBoundingClientRect().bottom < 0 ||
        this.currentRow!.getBoundingClientRect().top > window.innerHeight
      : false;
    const show = rowVisible && offscreen;
    this.scrollBtn.classList.toggle("visible", show);
    this.scrollBtn.setAttribute("aria-hidden", show ? "false" : "true");
  }

  // ── Volume ────────────────────────────────────────────────────────────
  private setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.player && this.player.setVolume) {
      this.player.setVolume(Math.round(this.volume * 100));
    }
    try {
      localStorage.setItem("music-player-volume", String(this.volume));
    } catch { /* nothing to remember it by, fine */ }
    this.paintVolumeSlider();
  }

  private toggleMute(): void {
    // Go through the site's one switch so the header speaker moves with this
    // button — the change comes back to us as a site-mute-change event.
    ClickAudio.toggleMute();
  }

  /**
   * Mute or unmute the music itself. The header's speaker is the site's master
   * switch — interaction sounds and the songs go together — so this is the
   * half of it that silences the player.
   */
  public setMuted(muted: boolean): void {
    if (muted === this.muted) return;
    if (muted) {
      this.muted = true;
      this.preMuteVolume = this.volume || 0.8;
      if (this.player && this.player.setVolume) this.player.setVolume(0);
    } else {
      this.muted = false;
      this.setVolume(this.preMuteVolume || this.volume || 0.8);
    }
    this.updateVolumeIcon();
    this.paintVolumeSlider();
  }

  private updateVolumeIcon(): void {
    const icon = this.playerContainer?.querySelector<HTMLElement>('.mp-vol-icon');
    const btn = this.playerContainer?.querySelector<HTMLButtonElement>('.mp-vol-btn');
    if (!icon || !btn) return;
    const quiet = this.muted || this.volume === 0;
    icon.textContent = quiet ? '🔇' : '🔈';
    btn.setAttribute('aria-label', quiet ? 'Unmute' : 'Mute');
  }

  /** The slider shows how much of it is filled, like the progress bar does. */
  private paintVolumeSlider(): void {
    const slider = this.playerContainer?.querySelector<HTMLInputElement>('.mp-volume-slider');
    if (!slider) return;
    const pct = Math.round(this.volume * 100);
    slider.value = String(pct);
    slider.style.background = `linear-gradient(90deg, var(--accent-color) ${pct}%, var(--border-color) ${pct}%)`;
  }

  public playQueue(tracks: Track[], startIndex: number = 0): void {
    this.queue = [...tracks];
    this.currentIndex = startIndex;
    this.renderQueue();
    if (!this.player || !this.player.loadVideoById) {
      this.pendingPlay = { tracks, index: startIndex };
      this.show();
      this.emitQueueChange();
      return;
    }
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
    this.setPlayingRow();
    this.renderQueue();
    this.emitQueueChange();
  }

  // ── Queue ─────────────────────────────────────────────────────────────
  /** True when the song already sits somewhere in the queue. */
  public isInQueue(videoId: string): boolean {
    return this.queue.some((t) => t.videoId === videoId);
  }

  /** The queue as it stands (a copy — callers can't mutate the player's). */
  public getQueue(): Track[] {
    return [...this.queue];
  }

  /**
   * Append a song to the queue. When nothing is on the air yet, the song
   * starts playing instead of waiting in a queue nobody can see.
   */
  public addToQueue(track: Track): boolean {
    if (this.isInQueue(track.videoId)) return false;
    const startingFresh = this.currentIndex < 0 || this.queue.length === 0;
    this.queue.push(track);
    if (startingFresh) {
      this.currentIndex = this.queue.length - 1;
      this.ensurePlaying();
    }
    this.renderQueue();
    this.emitQueueChange();
    return true;
  }

  /** Slot a song right after the one on the air. */
  public playNext(track: Track): boolean {
    if (this.isInQueue(track.videoId)) return false;
    const startingFresh = this.currentIndex < 0 || this.queue.length === 0;
    if (startingFresh) {
      this.queue.push(track);
      this.currentIndex = this.queue.length - 1;
      this.ensurePlaying();
    } else {
      this.queue.splice(this.currentIndex + 1, 0, track);
    }
    this.renderQueue();
    this.emitQueueChange();
    return true;
  }

  /**
   * Append a run of songs — a whole playlist dropped in behind whatever is on
   * — in one step, so a playlist is one queue operation rather than fifty.
   * Songs already queued are left where they are instead of turning up twice,
   * and the count of what was actually added is returned.
   */
  public addManyToQueue(tracks: Track[]): number {
    const startingFresh = this.currentIndex < 0 || this.queue.length === 0;
    const before = this.queue.length;
    let added = 0;
    for (const track of tracks) {
      if (this.isInQueue(track.videoId)) continue;
      this.queue.push(track);
      added++;
    }
    if (!added) return 0;
    if (startingFresh) {
      // Nothing was on the air, so the run starts with its own first song —
      // the way a single addToQueue would have started with the one it got.
      this.currentIndex = before;
      this.ensurePlaying();
    }
    this.renderQueue();
    this.emitQueueChange();
    return added;
  }

  /**
   * Slot a run of songs in after the one on the air, in order: the whole
   * playlist lands next. A song already waiting somewhere in the queue is left
   * where it is rather than added a second time — "play next" moves the run to
   * the front, it does not duplicate it.
   */
  public playNextMany(tracks: Track[]): number {
    if (!tracks.length) return 0;
    const startingFresh = this.currentIndex < 0 || this.queue.length === 0;
    if (startingFresh) {
      const before = this.queue.length;
      this.queue.push(...tracks);
      this.currentIndex = before;
      this.ensurePlaying();
    } else {
      const room = tracks.filter((t) => !this.isInQueue(t.videoId));
      if (!room.length) return 0;
      this.queue.splice(this.currentIndex + 1, 0, ...room);
      this.renderQueue();
      this.emitQueueChange();
      return room.length;
    }
    this.renderQueue();
    this.emitQueueChange();
    return tracks.length;
  }

  public removeFromQueue(index: number): void {
    if (index < 0 || index >= this.queue.length) return;
    const wasCurrent = index === this.currentIndex;
    this.queue.splice(index, 1);

    if (this.queue.length === 0) {
      this.currentIndex = -1;
      if (this.player && this.player.stopVideo) this.player.stopVideo();
      this.clearTrackInfo();
    } else if (index < this.currentIndex) {
      this.currentIndex--;
    } else if (wasCurrent) {
      // Whatever took its place is now the song on the air.
      if (this.currentIndex >= this.queue.length) this.currentIndex = 0;
      this.ensurePlaying();
    }

    this.renderQueue();
    this.emitQueueChange();
  }

  public jumpToQueueItem(index: number): void {
    if (index < 0 || index >= this.queue.length) return;
    this.currentIndex = index;
    this.ensurePlaying();
    this.renderQueue();
    this.emitQueueChange();
  }

  public clearQueue(): void {
    if (this.queue.length === 0) return;
    this.queue = [];
    this.currentIndex = -1;
    if (this.player && this.player.stopVideo) this.player.stopVideo();
    this.clearTrackInfo();
    this.renderQueue();
    this.emitQueueChange();
  }

  public toggleQueue(force?: boolean): void {
    const open = typeof force === "boolean" ? force : !this.queueOpen;
    this.queueOpen = open;
    this.queuePanel?.classList.toggle("hidden", !open);
    this.queueBtn?.setAttribute("aria-expanded", String(open));
    if (open) {
      this.renderQueue();
      // Land on the song that is actually on the air, not on the top of the
      // list — with a 60-song queue the playing track is usually far down.
      this.centerPlayingQueueItem();
    }
  }

  /** Scroll the queue list so the playing row sits in the middle of it. */
  private centerPlayingQueueItem(behavior: ScrollBehavior = "smooth"): void {
    const list = this.queueList;
    if (!list || !this.queueOpen) return;
    const el = list.querySelector<HTMLElement>(".mp-queue-item.playing");
    if (!el) return;
    // Measured against the list box so it does not depend on offsetParent.
    const rowTop =
      el.getBoundingClientRect().top -
      list.getBoundingClientRect().top +
      list.scrollTop;
    const top = rowTop - list.clientHeight / 2 + el.offsetHeight / 2;
    list.scrollTo({ top: Math.max(0, top), behavior });
  }

  private ensurePlaying(): void {
    if (this.currentIndex < 0 || this.currentIndex >= this.queue.length) return;
    if (!this.player || !this.player.loadVideoById) {
      this.pendingPlay = { tracks: [...this.queue], index: this.currentIndex };
      this.show();
      return;
    }
    this.show();
    this.playCurrent();
  }

  private clearTrackInfo(): void {
    const titleElem = this.playerContainer?.querySelector('.mp-title');
    const artistElem = this.playerContainer?.querySelector('.mp-artist');
    if (titleElem) titleElem.textContent = 'Not playing';
    if (artistElem) artistElem.textContent = 'Select a song';
    document.querySelectorAll('.song-list-item.playing').forEach((el) => el.classList.remove('playing'));
    this.currentRow = null;
    this.updateScrollBtnVisibility();
  }

  private onQueueListClick(event: Event): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const item = target.closest<HTMLElement>('[data-queue-index]');
    if (!item) return;
    const index = parseInt(item.getAttribute('data-queue-index') || '-1', 10);
    if (index < 0) return;
    if (target.closest('.mp-queue-remove')) {
      this.removeFromQueue(index);
      return;
    }
    this.jumpToQueueItem(index);
  }

  private renderQueue(): void {
    const total = this.queue.length;
    if (this.queuePanel) {
      this.queuePanel.classList.toggle('is-empty', total === 0);
      const totalEl = this.queuePanel.querySelector<HTMLElement>('.mp-queue-total');
      if (totalEl) totalEl.textContent = `${total} song${total === 1 ? '' : 's'}`;
    }
    if (this.queueList) {
      // Rebuilding the HTML resets the scroll position; hold the reader where
      // they were, and follow the music when the song on the air changes.
      const keepTop = this.queueList.scrollTop;
      const playingBefore = this.renderedPlaying;
      this.queueList.innerHTML = this.queue
        .map((track, i) => `
          <li class="mp-queue-item ${i === this.currentIndex ? 'playing' : ''}" data-queue-index="${i}">
            <button class="mp-queue-track" type="button">
              <span class="mp-queue-index">${i === this.currentIndex ? '♪' : i + 1}</span>
              <span class="mp-queue-info">
                <span class="mp-queue-track-title">${escapeHtml(track.title)}</span>
                <span class="mp-queue-track-artist">${escapeHtml(track.artist || 'Unknown Artist')}</span>
              </span>
            </button>
            <button class="mp-queue-remove" type="button" aria-label="Remove ${escapeHtml(track.title)} from queue">×</button>
          </li>
        `)
        .join('');
      this.queueList.scrollTop = keepTop;
      this.renderedPlaying = this.currentIndex;
      if (this.queueOpen && this.currentIndex !== playingBefore) this.centerPlayingQueueItem();
    }
    this.updateQueueBadge();
  }

  private updateQueueBadge(): void {
    if (!this.queueBtn) return;
    const upcoming = this.queue.length - (this.currentIndex + 1);
    const badge = this.queueBtn.querySelector<HTMLElement>('.mp-queue-count');
    if (!badge) return;
    badge.textContent = upcoming > 0 ? String(upcoming) : '';
    badge.hidden = upcoming <= 0;
  }

  private emitQueueChange(): void {
    document.dispatchEvent(new CustomEvent('music-player-queue-change', {
      detail: { tracks: [...this.queue], currentIndex: this.currentIndex },
    }));
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
    this.toggleQueue(false);
    if (this.player) this.player.pauseVideo();
    // The music is gone, so the row no longer plays anything.
    document.querySelectorAll(".song-list-item.playing").forEach((el) => el.classList.remove("playing"));
    this.currentRow = null;
    this.updateScrollBtnVisibility();
  }
}
