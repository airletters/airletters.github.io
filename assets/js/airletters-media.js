(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function svg(d) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="' + d + '"/></svg>';
  }

  var ICON = {
    play: svg('M8 5v14l11-7z'),
    pause: svg('M6 19h4V5H6v14zm8-14v14h4V5h-4z'),
    prev: svg('M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z'),
    next: svg('M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z'),
    open: svg('M21 11V3h-8l3.29 3.29-10 10L3 13v8h8l-3.29-3.29 10-10z'),
    figure: svg('M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z'),
    grid: svg('M4 11h5V5H4v6zm0 7h5v-6H4v6zm6 0h5v-6h-5v6zm6 0h5v-6h-5v6zm-6-7h5V5h-5v6zm6-6v6h5V5h-5z'),
    still: svg('M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z'),
    wave: svg('M23 5.5V20c0 2.2-1.8 4-4 4h-7.3c-1.08 0-2.1-.43-2.85-1.19L1 14.83s1.26-1.23 1.3-1.25c.22-.19.49-.29.79-.29.22 0 .42.06.6.16.04.01 4.31 2.46 4.31 2.46V4c0-.83.67-1.5 1.5-1.5S11 3.17 11 4v7h1V1.5c0-.83.67-1.5 1.5-1.5S15 .67 15 1.5V11h1V2.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5V11h1V5.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5z')
  };

  function h(tag, cls, html) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html != null) node.innerHTML = html;
    return node;
  }

  function button(cls, html, label) {
    var b = h('button', cls, html);
    b.type = 'button';
    if (label) b.setAttribute('aria-label', label);
    return b;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function getJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + ': ' + r.status);
      return r.json();
    });
  }

  function mark(it) {
    return it.glyph ? esc(it.glyph) : ICON[it.icon] || '';
  }

  function Player(opts) {
    var self = this;
    this.opts = opts || {};
    this.item = null;
    this.duration = 0;
    this.visible = false;
    this.userPaused = false;
    this.consent = false;
    this.raf = 0;
    this.still = false;
    this.stillT = 0;
    this.stillRun = false;
    this.stillLast = 0;

    this.el = h('div', 'al-player');
    this.stage = h('div', 'al-stage is-paused');
    var v = this.video = document.createElement('video');
    v.muted = true;
    v.defaultMuted = true;
    v.playsInline = true;
    v.setAttribute('muted', '');
    v.setAttribute('playsinline', '');
    v.preload = 'none';

    this.img = h('img', 'al-still');
    this.img.decoding = 'async';
    this.img.hidden = true;
    this.badge = h('span', 'al-badge');
    this.open = h('a', 'al-open', ICON.open + '<span>Full size</span>');
    this.open.target = '_blank';
    this.open.rel = 'noopener';
    this.open.hidden = true;
    this.big = button('al-bigplay', ICON.play, 'Play');
    this.stage.append(v, this.img, this.badge, this.open, this.big);

    this.bar = h('div', 'al-timeline');
    this.playBtn = button('al-play', ICON.play, 'Play');
    this.track = h('div', 'al-track');
    this.track.tabIndex = 0;
    this.track.setAttribute('role', 'slider');
    this.track.setAttribute('aria-label', 'Seek');
    this.track.setAttribute('aria-valuemin', '0');
    this.fill = h('div', 'al-fill');
    this.track.append(this.fill);
    this.time = h('span', 'al-time');
    this.bar.append(this.playBtn, this.track, this.time);
    this.el.append(this.stage, this.bar);

    function onVideo(type, fn) {
      v.addEventListener(type, function (e) { if (!self.still) fn(e); });
    }
    onVideo('playing', function () {
      self.stage.classList.remove('is-paused', 'is-loading');
      self.setButton(true);
      self.tickLoop();
    });
    onVideo('play', function () {
      self.stage.classList.remove('is-paused');
      self.setButton(true);
    });
    onVideo('pause', function () {
      if (!v.ended) self.stage.classList.add('is-paused');
      self.setButton(false);
      self.render(v.currentTime);
    });
    onVideo('waiting', function () { self.stage.classList.add('is-loading'); });
    onVideo('canplay', function () { self.stage.classList.remove('is-loading'); });
    onVideo('loadedmetadata', function () {
      if (isFinite(v.duration) && v.duration > 0) self.duration = v.duration;
      self.track.setAttribute('aria-valuemax', self.duration.toFixed(1));
      self.render(v.currentTime);
    });
    onVideo('timeupdate', function () { if (v.paused) self.render(v.currentTime); });
    onVideo('ended', function () {
      self.render(self.duration);
      if (self.opts.onEnded) self.opts.onEnded();
    });

    v.addEventListener('click', function () { self.toggle(); });
    this.img.addEventListener('click', function () { self.toggle(); });
    this.big.addEventListener('click', function () { self.userPlay(); });
    this.playBtn.addEventListener('click', function () { self.toggle(); });

    var dragging = false;
    function seekFromPointer(e) {
      var r = self.track.getBoundingClientRect();
      var f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      self.seek(f * (self.duration || 0));
    }
    this.track.addEventListener('pointerdown', function (e) {
      dragging = true;
      if (self.track.setPointerCapture) self.track.setPointerCapture(e.pointerId);
      seekFromPointer(e);
    });
    this.track.addEventListener('pointermove', function (e) { if (dragging) seekFromPointer(e); });
    ['pointerup', 'pointercancel'].forEach(function (type) {
      self.track.addEventListener(type, function () { dragging = false; });
    });
    this.track.addEventListener('keydown', function (e) {
      var step = { ArrowLeft: -0.25, ArrowRight: 0.25, ArrowDown: -0.25, ArrowUp: 0.25 }[e.key];
      if (step) {
        e.preventDefault();
        self.seek(self.currentTime() + step);
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        self.seek(e.key === 'Home' ? 0 : self.duration);
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        self.toggle();
      }
    });
  }

  Player.prototype.load = function (item) {
    var v = this.video;
    this.item = item;
    this.duration = item.duration;
    this.still = item.kind === 'figure';
    this.stillRun = false;
    this.stillT = 0;
    cancelAnimationFrame(this.raf);
    this.stage.classList.toggle('is-still', this.still);
    this.stage.classList.remove('is-loading');
    this.badge.textContent = item.tag;
    if (this.still) {
      if (v.getAttribute('src')) {
        v.pause();
        v.removeAttribute('src');
        v.removeAttribute('poster');
        v.load();
      }
      v.hidden = true;
      this.img.alt = item.alt || item.title;
      this.img.width = item.width;
      this.img.height = item.height;
      this.img.src = item.src;
      this.img.hidden = false;
      this.open.href = item.full || item.src;
      this.open.setAttribute('aria-label', 'Open the figure at full size');
      this.open.hidden = false;
    } else {
      this.img.hidden = true;
      this.img.removeAttribute('src');
      this.open.hidden = true;
      v.hidden = false;
      v.poster = item.poster;
      v.preload = this.visible ? 'auto' : 'none';
      v.src = item.src;
      v.setAttribute('aria-label', 'AirLetters clip: ' + item.label);
    }
    this.track.setAttribute('aria-valuemax', this.duration.toFixed(1));
    this.render(0);
    this.setButton(false);
    if (this.shouldPlay()) this.play();
    else this.stage.classList.add('is-paused');
  };

  Player.prototype.shouldPlay = function () {
    return this.visible && !this.userPaused && !document.hidden && (!reduceMotion || this.consent);
  };

  Player.prototype.isPaused = function () {
    return this.still ? !this.stillRun : this.video.paused;
  };

  Player.prototype.isEnded = function () {
    return this.still ? this.stillT >= this.duration : this.video.ended;
  };

  Player.prototype.currentTime = function () {
    return this.still ? this.stillT : this.video.currentTime;
  };

  Player.prototype.userPlay = function () {
    this.consent = true;
    this.userPaused = false;
    this.play();
  };

  Player.prototype.play = function () {
    var self = this;
    if (this.still) return this.playStill();
    var v = this.video;
    var item = this.item;
    if (v.preload !== 'auto') v.preload = 'auto';
    var p = v.play();
    if (p && p.catch) {
      p.catch(function () {
        if (self.item === item && !self.still) self.stage.classList.add('is-paused');
      });
    }
  };

  Player.prototype.playStill = function () {
    var self = this;
    if (this.stillT >= this.duration) this.stillT = 0;
    this.stillRun = true;
    this.stillLast = performance.now();
    this.stage.classList.remove('is-paused');
    this.setButton(true);
    cancelAnimationFrame(this.raf);
    function step(now) {
      if (!self.stillRun) return;
      self.stillT += Math.max(0, now - self.stillLast) / 1000;
      self.stillLast = now;
      if (self.stillT >= self.duration) {
        self.stillT = self.duration;
        self.stillRun = false;
        self.render(self.duration);
        self.setButton(false);
        if (self.opts.onEnded) self.opts.onEnded();
        return;
      }
      self.render(self.stillT);
      self.raf = requestAnimationFrame(step);
    }
    this.raf = requestAnimationFrame(step);
  };

  Player.prototype.pause = function () {
    if (!this.still) return this.video.pause();
    this.stillRun = false;
    cancelAnimationFrame(this.raf);
    this.stage.classList.add('is-paused');
    this.setButton(false);
    this.render(this.stillT);
  };

  Player.prototype.toggle = function () {
    if (this.isPaused()) {
      this.userPlay();
    } else {
      this.userPaused = true;
      this.pause();
    }
  };

  Player.prototype.restart = function () {
    this.seek(0);
    if (this.shouldPlay()) this.play();
  };

  Player.prototype.seek = function (t) {
    var d = this.duration || 0;
    t = Math.min(Math.max(0, t), d);
    if (this.still) {
      this.stillT = t;
    } else {
      try {
        this.video.currentTime = t;
      } catch (e) { /* not seekable yet */ }
    }
    this.render(t);
  };

  Player.prototype.setVisible = function (on) {
    this.visible = on;
    if (on && this.shouldPlay()) {
      if (this.isPaused() && !this.isEnded()) this.play();
    } else if (!on && !this.isPaused()) {
      this.pause();
    }
  };

  Player.prototype.setButton = function (playing) {
    this.playBtn.innerHTML = playing ? ICON.pause : ICON.play;
    this.playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  };

  Player.prototype.render = function (t) {
    var d = this.duration || 0;
    t = Math.min(Math.max(0, t || 0), d);
    this.fill.style.width = d ? (100 * t / d) + '%' : '0';
    this.time.textContent = t.toFixed(1) + ' / ' + d.toFixed(1) + ' s';
    this.track.setAttribute('aria-valuenow', t.toFixed(1));
    this.track.setAttribute('aria-valuetext', t.toFixed(1) + ' seconds');
    if (this.opts.onTick) this.opts.onTick(t, d);
  };

  Player.prototype.tickLoop = function () {
    var self = this;
    cancelAnimationFrame(this.raf);
    function step() {
      self.render(self.video.currentTime);
      if (!self.video.paused && !self.video.ended) self.raf = requestAnimationFrame(step);
    }
    this.raf = requestAnimationFrame(step);
  };

  function observeVisibility(player, target, threshold) {
    var inView = false;
    function sync() { player.setVisible(inView && !document.hidden); }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        var e = entries[entries.length - 1];
        inView = e.isIntersecting && e.intersectionRatio >= threshold - 0.01;
        sync();
      }, { threshold: [0, threshold] }).observe(target);
    } else {
      inView = true;
      sync();
    }
    document.addEventListener('visibilitychange', sync);
  }

  var HEADINGS = { clip: 'Why it’s hard', contrast: 'About this class' };

  function Gallery(root) {
    var self = this;
    this.root = root;
    this.items = [];
    this.index = -1;
    this.auto = true;
    this.hold = 0;
    this.plays = 0;
    getJSON(root.getAttribute('data-src'))
      .then(function (d) { self.build(d.clips || []); })
      .catch(function (err) {
        root.classList.add('is-failed');
        if (window.console) console.warn(err);
      });
  }

  Gallery.prototype.build = function (items) {
    var self = this;
    if (!items.length) throw new Error('empty gallery');
    this.items = items;

    this.player = new Player({
      onTick: function (t, d) { self.tick(t, d); },
      onEnded: function () { self.ended(); }
    });

    var panel = this.panel = h('div', 'al-panel');
    this.meta = h('div', 'al-meta', '<span class="al-tag"></span><span class="al-count"></span>');
    var head = h('div', 'al-head');
    this.glyph = h('span', 'al-glyph');
    this.glyph.setAttribute('aria-hidden', 'true');
    var titles = h('span', 'al-titles');
    this.title = h('span', 'al-title');
    this.label = h('span', 'al-label');
    titles.append(this.title, this.label);
    head.append(this.glyph, titles);
    this.confused = h('div', 'al-confused', '<span class="al-sub">Easily confused with</span>');
    this.confusedList = h('span', 'al-confused-list');
    this.confused.append(this.confusedList);
    this.whyHead = h('div', 'al-sub');
    this.why = h('p', 'al-why');
    panel.append(this.meta, head, this.confused, this.whyHead, this.why);
    panel.setAttribute('aria-live', 'polite');

    var main = this.main = h('div', 'al-main');
    main.append(this.player.el, panel);

    var clips = items.filter(function (it) { return it.kind === 'clip' || it.kind === 'contrast'; }).length;
    var strip = h('div', 'al-strip');
    var head2 = h('div', 'al-strip-head', '<span><strong>' + clips + ' real clips</strong> from the dataset, plus the teaser and paper figures' +
      '<span class="al-strip-tip"> · <span class="al-on-hover">click</span><span class="al-on-touch">tap</span> any to explore</span></span>');
    this.autoBtn = button('al-auto', '<span class="al-auto-track" aria-hidden="true"></span><span>Auto-advance</span>');
    this.autoBtn.setAttribute('role', 'switch');
    this.autoBtn.setAttribute('aria-checked', String(this.auto));
    this.autoBtn.addEventListener('click', function () { self.setAuto(!self.auto, true); });
    head2.append(this.autoBtn);

    var row = h('div', 'al-strip-row');
    var prev = button('al-nav', ICON.prev, 'Previous example');
    var next = button('al-nav', ICON.next, 'Next example');
    prev.addEventListener('click', function () { self.pick(self.index - 1); });
    next.addEventListener('click', function () { self.pick(self.index + 1); });
    this.thumbs = h('div', 'al-thumbs');
    items.forEach(function (it, i) {
      var b = button('al-thumb al-kind-' + it.kind, null, 'Example ' + (i + 1) + ': ' + it.title);
      b.innerHTML = '<span class="al-thumb-img"><img src="' + esc(it.thumb) + '" alt="" width="256" height="144" loading="lazy" decoding="async">' +
        '<span class="al-thumb-mark">' + mark(it) + '</span><span class="al-thumb-bar"></span></span>' +
        '<span class="al-thumb-t">' + esc(it.kind === 'figure' ? 'Paper figure' : it.title) + '</span>';
      b.addEventListener('click', function () { self.pick(i); });
      self.thumbs.append(b);
    });
    row.append(prev, this.thumbs, next);
    strip.append(head2, row);

    var body = this.root.querySelector('.al-body');
    body.innerHTML = '';
    body.append(main, strip);

    this.root.addEventListener('keydown', function (e) {
      if (e.target === self.player.track || /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        self.pick(self.index + (e.key === 'ArrowRight' ? 1 : -1));
      }
    });

    this.fitPanel();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { self.fitPanel(); });
    var resizeTimer = 0;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { self.fitPanel(); }, 200);
    });

    this.select(0);
    observeVisibility(this.player, this.player.stage, 0.35);
  };

  Gallery.prototype.fillPanel = function (it) {
    var self = this;
    this.meta.firstChild.textContent = it.tag;
    this.panel.classList.toggle('is-figure', it.kind === 'figure');
    this.glyph.className = 'al-glyph ' + (it.glyph ? 'is-char' : 'is-icon') + ' al-kind-' + it.kind;
    this.glyph.innerHTML = mark(it);
    this.title.textContent = it.title;
    this.label.textContent = it.kind === 'clip' || it.kind === 'contrast' ? '“' + it.label + '”' : it.label;
    this.label.hidden = !it.label || it.label.toLowerCase() === it.title.toLowerCase();
    this.confusedList.innerHTML = '';
    (it.confused || []).forEach(function (g) {
      var j = self.indexOfGlyph(g);
      var b = button('al-cchip', esc(g), j < 0 ? null : 'Show a clip of ' + g);
      if (j < 0) b.disabled = true;
      else b.addEventListener('click', function () { self.pick(j); });
      self.confusedList.append(b);
    });
    this.confused.hidden = !(it.confused && it.confused.length);
    this.whyHead.textContent = HEADINGS[it.kind] || '';
    this.whyHead.hidden = !HEADINGS[it.kind];
    this.why.textContent = it.why;
  };

  Gallery.prototype.indexOfGlyph = function (g) {
    for (var i = 0; i < this.items.length; i++) {
      if (this.items[i].glyph === g) return i;
    }
    return -1;
  };

  Gallery.prototype.fitPanel = function () {
    var panel = this.panel;
    panel.style.minHeight = '';
    if (!window.matchMedia('(min-width: 769px)').matches) return;
    var max = 0;
    var cur = this.items[this.index];
    for (var i = 0; i < this.items.length; i++) {
      this.fillPanel(this.items[i]);
      max = Math.max(max, panel.offsetHeight);
    }
    if (cur) this.fillPanel(cur);
    panel.style.minHeight = max + 'px';
  };

  Gallery.prototype.select = function (i) {
    var n = this.items.length;
    i = ((i % n) + n) % n;
    clearTimeout(this.hold);
    this.plays = 0;
    var old = this.thumbs.children[this.index];
    if (old) {
      old.removeAttribute('aria-current');
      old.querySelector('.al-thumb-bar').style.width = '0';
    }
    this.index = i;
    var it = this.items[i];
    var cur = this.thumbs.children[i];
    cur.setAttribute('aria-current', 'true');
    this.meta.lastChild.textContent = (i + 1) + ' / ' + n;
    this.fillPanel(it);
    this.scrollThumb(cur);
    this.player.load(it);
    var nextItem = this.items[(i + 1) % n];
    if (nextItem && nextItem.poster && !nextItem.warm) {
      nextItem.warm = true;
      new Image().src = nextItem.poster;
    }
  };

  Gallery.prototype.tick = function (t, d) {
    var cur = this.thumbs.children[this.index];
    if (cur && d) cur.querySelector('.al-thumb-bar').style.width = (100 * t / d) + '%';
  };

  Gallery.prototype.pick = function (i) {
    this.player.consent = true;
    this.player.userPaused = false;
    if (i === this.index) {
      clearTimeout(this.hold);
      this.plays = 0;
      this.player.restart();
    } else {
      this.select(i);
    }
  };

  Gallery.prototype.ended = function () {
    var self = this;
    var it = this.items[this.index];
    clearTimeout(this.hold);
    if (this.player.userPaused) return;
    this.plays++;
    var again = it.kind !== 'figure' && it.duration < 5 && this.plays < 2;
    if (this.auto && !again) {
      this.hold = setTimeout(function () { self.select(self.index + 1); }, 900);
    } else {
      this.hold = setTimeout(function () { self.player.restart(); }, again ? 250 : 1200);
    }
  };

  Gallery.prototype.setAuto = function (on, fromToggle) {
    var p = this.player;
    this.auto = on;
    if (this.autoBtn) this.autoBtn.setAttribute('aria-checked', String(on));
    if (!fromToggle || !p) return;
    if (on) {
      p.consent = true;
      p.userPaused = false;
    }
    if (p.isEnded()) this.ended();
    else if (on && p.isPaused() && p.shouldPlay()) p.play();
  };

  Gallery.prototype.scrollThumb = function (b) {
    var s = this.thumbs;
    var left = b.offsetLeft - (s.clientWidth - b.offsetWidth) / 2;
    if (s.scrollTo) s.scrollTo({ left: Math.max(0, left), behavior: reduceMotion ? 'auto' : 'smooth' });
    else s.scrollLeft = left;
  };

  [].forEach.call(document.querySelectorAll('.al-viewer[data-src]'), function (el) { new Gallery(el); });
})();
