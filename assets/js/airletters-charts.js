(function () {
  'use strict';

  var script = document.currentScript;
  var DATA_URL = (script && script.getAttribute('data-scaling')) || './assets/data/airletters_scaling.json';
  var LIB_SRC = 'https://cdn.jsdelivr.net/npm/chart.js@4.6.1/dist/chart.umd.min.js';
  var LIB_SRI = 'sha384-Emf5ZVIUiarAdhkgtqK+5/Z5qIvM6QoVrS+qAVtfyZVuD5lIHrac0me485+Antp0';
  var FONT = "'Noto Sans', system-ui, -apple-system, 'Segoe UI', sans-serif";

  var boxes = [].slice.call(document.querySelectorAll('[data-al-chart]'));
  if (!boxes.length) return;

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var ANIMATION = reduceMotion ? false : { duration: 600 };

  var GROUPS = [
    { key: 'Image', label: 'Image models', color: '#e8590c' },
    { key: 'Video', label: 'Video models', color: '#1769aa' },
    { key: 'VLM', label: 'Vision-language models', color: '#7048e8' }
  ];

  var loading = null;
  var rendered = new Map();
  var scaling = null;
  var board = null;

  function loadAll() {
    if (loading) return loading;
    var lib = window.Chart ? Promise.resolve() : new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = LIB_SRC;
      s.integrity = LIB_SRI;
      s.crossOrigin = 'anonymous';
      s.async = true;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Chart.js failed to load')); };
      document.head.appendChild(s);
    });
    var data = fetch(DATA_URL).then(function (r) {
      if (!r.ok) throw new Error(DATA_URL + ': ' + r.status);
      return r.json();
    });
    loading = Promise.all([lib, data]).then(function (r) {
      scaling = r[1];
      window.Chart.defaults.font.family = FONT;
    });
    return loading;
  }

  function readBoard() {
    var table = document.getElementById('leaderboard-table');
    var rows = [];
    var human = null;
    [].forEach.call(table.tBodies[0].rows, function (tr) {
      var c = tr.cells;
      var row = { name: c[0].textContent.trim(), type: c[1].textContent.trim(), acc: parseFloat(c[2].textContent) };
      if (row.type === 'Human') human = row;
      else rows.push(row);
    });
    var order = GROUPS.map(function (g) { return g.key; });
    rows.sort(function (a, b) {
      return order.indexOf(a.type) - order.indexOf(b.type) || a.acc - b.acc;
    });
    var best = rows.reduce(function (m, r) { return r.acc > m.acc ? r : m; }, rows[0]);
    return { rows: rows, human: human, best: best };
  }

  function theme(el) {
    var cs = getComputedStyle(el);
    function v(name, fallback) { return (cs.getPropertyValue(name) || '').trim() || fallback; }
    return {
      text: v('--al-text', '#1f2937'),
      muted: v('--al-muted', '#4b5563'),
      grid: v('--al-grid', 'rgba(31, 41, 55, 0.1)'),
      card: v('--al-card', '#ffffff'),
      band: v('--al-band', 'rgba(23, 105, 170, 0.05)')
    };
  }

  function pct(v) { return v.toFixed(2) + '%'; }

  function signed(v) { return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2); }

  function wrap(label, width) {
    var out = [];
    var line = '';
    label.split(' ').forEach(function (w) {
      if (line && (line + ' ' + w).length > width) {
        out.push(line);
        line = w;
      } else {
        line = line ? line + ' ' + w : w;
      }
    });
    if (line) out.push(line);
    return out;
  }

  function columnLabel(name, width) {
    var parts = [];
    name.split(' ').forEach(function (w) {
      if (w.length > width - 1 && /-./.test(w)) {
        w.replace(/-/g, '-\n').split('\n').forEach(function (p) { if (p) parts.push(p); });
      } else if (w.length > width + 1 && /[a-z][A-Z]/.test(w)) {
        var m = /^(.*?[a-z])([A-Z].*)$/.exec(w);
        parts.push(m[1], m[2]);
      } else {
        parts.push(w);
      }
    });
    var out = [];
    var line = '';
    parts.forEach(function (p) {
      var joined = !line ? p : /-$/.test(line) ? line + p : line + ' ' + p;
      if (line && joined.length > width) {
        out.push(line);
        line = p;
      } else {
        line = joined;
      }
    });
    if (line) out.push(line);
    return out;
  }

  function legend(t, small, labels, extra) {
    var l = {
      position: 'bottom',
      labels: {
        color: t.text,
        usePointStyle: true,
        boxWidth: 10,
        boxHeight: 10,
        padding: small ? 12 : 16,
        font: { size: 13 }
      },
      onHover: function (e) { e.native.target.style.cursor = 'pointer'; },
      onLeave: function (e) { e.native.target.style.cursor = ''; }
    };
    var k;
    for (k in labels || {}) l.labels[k] = labels[k];
    for (k in extra || {}) l[k] = extra[k];
    return l;
  }

  function tooltip(callbacks, extra) {
    var t = {
      padding: 10,
      boxPadding: 4,
      usePointStyle: true,
      titleFont: { size: 13, weight: '600' },
      bodyFont: { size: 13 },
      footerFont: { size: 12, weight: '500' },
      callbacks: callbacks
    };
    for (var k in extra || {}) t[k] = extra[k];
    return t;
  }

  function valueScale(t, title, max) {
    return {
      min: 0,
      max: max,
      ticks: { stepSize: 20, color: t.muted, font: { size: 12 } },
      grid: { color: t.grid },
      border: { display: false },
      title: { display: true, text: title, color: t.muted, font: { size: 12 } }
    };
  }

  var humanLine = {
    id: 'alHuman',
    afterDatasetsDraw: function (chart, args, opts) {
      if (!opts || !opts.show) return;
      var area = chart.chartArea;
      var horizontal = chart.options.indexAxis === 'y';
      var scale = chart.scales[horizontal ? 'x' : 'y'];
      var p = scale.getPixelForValue(opts.value);
      var ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = opts.color;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      if (horizontal) {
        ctx.moveTo(p, area.top);
        ctx.lineTo(p, area.bottom);
      } else {
        ctx.moveTo(area.left, p);
        ctx.lineTo(area.right, p);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = opts.color;
      ctx.font = '600 12px ' + FONT;
      var text = 'Human ' + opts.value.toFixed(2);
      if (horizontal) {
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(text, p - 4, area.top + 2);
      } else {
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(text, area.right - 4, p + 4);
      }
      ctx.restore();
    }
  };

  var groupBands = {
    id: 'alBands',
    beforeDatasetsDraw: function (chart, args, opts) {
      if (!opts || !opts.spans) return;
      var horizontal = chart.options.indexAxis === 'y';
      var cat = chart.scales[horizontal ? 'y' : 'x'];
      var area = chart.chartArea;
      var ctx = chart.ctx;
      var step = cat.getPixelForValue(1) - cat.getPixelForValue(0) || (horizontal ? area.height : area.width);
      ctx.save();
      opts.spans.forEach(function (s, i) {
        var a = cat.getPixelForValue(s.from) - step / 2;
        var b = cat.getPixelForValue(s.to) + step / 2;
        if (i % 2 === 0) {
          ctx.fillStyle = opts.band;
          if (horizontal) ctx.fillRect(area.left, a, area.right - area.left, b - a);
          else ctx.fillRect(a, area.top, b - a, area.bottom - area.top);
        }
        if (!horizontal) {
          ctx.fillStyle = s.color;
          ctx.font = '600 12px ' + FONT;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(s.label, (a + b) / 2, area.top - 6);
        }
      });
      ctx.restore();
    }
  };

  var valueLabels = {
    id: 'alValues',
    afterDatasetsDraw: function (chart, args, opts) {
      if (!opts || !opts.display) return;
      var ctx = chart.ctx;
      var horizontal = chart.options.indexAxis === 'y';
      ctx.save();
      ctx.font = '600 ' + (opts.size || 11) + 'px ' + FONT;
      ctx.fillStyle = opts.color;
      chart.data.datasets.forEach(function (ds, di) {
        if (!chart.isDatasetVisible(di) || ds.type === 'line') return;
        chart.getDatasetMeta(di).data.forEach(function (bar, i) {
          var v = ds.data[i];
          if (v == null) return;
          if (horizontal) {
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(v.toFixed(2), bar.x + 4, bar.y);
          } else {
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(v.toFixed(2), bar.x, bar.y - 3);
          }
        });
      });
      ctx.restore();
    }
  };

  var builders = {
    scaling: function (box, t, mode) {
      var d = scaling;
      var small = mode === 'narrow';
      var frames = d.frames;
      function points(arr) { return arr.map(function (y, i) { return { x: frames[i], y: y }; }); }
      var datasets = d.series.map(function (s) {
        return {
          label: s.label,
          data: points(s.data),
          borderColor: s.color,
          backgroundColor: s.color,
          borderWidth: 2,
          pointRadius: small ? 3.5 : 4.5,
          pointHoverRadius: 7,
          pointBorderColor: t.card,
          pointBorderWidth: 1,
          tension: 0
        };
      });
      datasets.push({
        label: d.frontier.label,
        data: points(d.frontier.data),
        borderColor: t.text,
        backgroundColor: t.text,
        borderWidth: 2.5,
        borderDash: [6, 4],
        pointRadius: 0,
        pointHoverRadius: 0,
        pointStyle: 'line',
        order: -1
      });
      return {
        type: 'line',
        data: { datasets: datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: ANIMATION,
          interaction: { mode: 'index', intersect: false },
          scales: {
            x: {
              type: 'linear',
              min: 0,
              max: 50,
              afterBuildTicks: function (axis) { axis.ticks = frames.map(function (f) { return { value: f }; }); },
              ticks: { color: t.text, font: { size: 12 } },
              grid: { color: t.grid },
              border: { color: t.grid },
              title: { display: true, text: 'Training frames per video', color: t.muted, font: { size: 12 } }
            },
            y: valueScale(t, 'Top-1 accuracy (%)', 80)
          },
          plugins: {
            legend: legend(t, small, { sort: function (a, b) { return a.datasetIndex - b.datasetIndex; } }),
            tooltip: tooltip({
              title: function (items) {
                var f = items[0].parsed.x;
                return f === 1 ? '1 frame (image model)' : f + ' frames';
              },
              label: function (ctx) { return ' ' + ctx.dataset.label + ': ' + pct(ctx.parsed.y); }
            }, { itemSort: function (a, b) { return b.parsed.y - a.parsed.y; } })
          }
        }
      };
    },

    leaderboard: function (box, t, mode, state) {
      var horizontal = mode === 'h';
      var rows = board.rows.filter(function (r) { return !state.hidden[r.type]; });
      var spans = [];
      GROUPS.forEach(function (g) {
        var idx = [];
        rows.forEach(function (r, i) { if (r.type === g.key) idx.push(i); });
        if (idx.length) spans.push({ from: idx[0], to: idx[idx.length - 1], label: g.label, color: g.color });
      });
      var labels = rows.map(function (r) { return horizontal ? wrap(r.name, 18) : columnLabel(r.name, 8); });
      var datasets = GROUPS.map(function (g) {
        return {
          label: g.label,
          group: g.key,
          data: rows.map(function (r) { return r.type === g.key ? r.acc : null; }),
          backgroundColor: g.color,
          borderRadius: 3,
          grouped: false,
          categoryPercentage: 0.8,
          barPercentage: 0.9,
          maxBarThickness: horizontal ? 18 : 34,
          hidden: !!state.hidden[g.key]
        };
      });
      var bestIndex = rows.indexOf(board.best);
      var catScale = {
        grid: { display: false },
        border: { color: t.grid },
        ticks: {
          color: t.text,
          autoSkip: false,
          maxRotation: 0,
          minRotation: 0,
          font: function (ctx) { return { size: horizontal ? 12 : 11, weight: ctx.index === bestIndex ? '700' : '400' }; }
        }
      };
      var human = board.human;
      return {
        type: 'bar',
        data: { labels: labels, datasets: datasets },
        plugins: [groupBands, valueLabels, humanLine],
        options: {
          indexAxis: horizontal ? 'y' : 'x',
          responsive: true,
          maintainAspectRatio: false,
          animation: ANIMATION,
          layout: { padding: { top: horizontal ? 0 : 24, right: horizontal ? 40 : 0 } },
          interaction: { mode: 'index', intersect: false, axis: horizontal ? 'y' : 'x' },
          scales: horizontal
            ? { x: valueScale(t, 'Top-1 accuracy (%)', 100), y: catScale }
            : { x: catScale, y: valueScale(t, 'Top-1 accuracy (%)', 100) },
          plugins: {
            alBands: { spans: spans, band: t.band },
            alValues: { display: true, color: t.text, size: horizontal ? 11 : 10 },
            alHuman: { show: !state.hidden.Human && !!human, value: human ? human.acc : 0, color: t.text },
            legend: legend(t, horizontal, {
              generateLabels: function (chart) {
                var items = window.Chart.defaults.plugins.legend.labels.generateLabels(chart);
                items.forEach(function (it) { it.pointStyle = 'rectRounded'; });
                if (human) {
                  items.push({
                    text: 'Human ' + human.acc.toFixed(2),
                    fillStyle: 'rgba(0,0,0,0)',
                    strokeStyle: t.text,
                    fontColor: t.text,
                    lineWidth: 2,
                    lineDash: [4, 3],
                    pointStyle: 'line',
                    hidden: !!state.hidden.Human,
                    datasetIndex: -1
                  });
                }
                return items;
              }
            }, {
              onClick: function (e, item, l) {
                var key = item.datasetIndex < 0 ? 'Human' : l.chart.data.datasets[item.datasetIndex].group;
                state.hidden[key] = !state.hidden[key];
                setTimeout(function () { render(box, true); }, 0);
              }
            }),
            tooltip: tooltip({
              title: function (items) { return rows[items[0].dataIndex].name; },
              label: function (ctx) {
                var r = rows[ctx.dataIndex];
                return ' ' + r.type + ' model: ' + pct(r.acc);
              },
              footer: function (items) {
                if (!human) return '';
                var r = rows[items[0].dataIndex];
                return 'vs. human (' + human.acc.toFixed(2) + '): ' + signed(r.acc - human.acc) + ' points';
              }
            }, { filter: function (item) { return item.raw != null; } })
          }
        }
      };
    }
  };

  function modeFor(kind, box) {
    var w = box.clientWidth;
    if (kind === 'scaling') return w < 560 ? 'narrow' : 'wide';
    return w < 820 ? 'h' : 'v';
  }

  function sizeFor(kind, mode, state) {
    if (kind === 'scaling') return mode === 'narrow' ? '440px' : '';
    if (mode !== 'h') return '';
    var n = board.rows.filter(function (r) { return !state.hidden[r.type]; }).length;
    return (n * 34 + 150) + 'px';
  }

  function render(box, force) {
    var kind = box.getAttribute('data-al-chart');
    var mode = modeFor(kind, box);
    var prev = rendered.get(box);
    if (prev && prev.mode === mode && !force) return;
    var state = prev ? prev.state : { hidden: {} };
    if (prev) {
      if (kind === 'scaling') {
        state.visible = prev.chart.data.datasets.map(function (ds, i) { return prev.chart.isDatasetVisible(i); });
      }
      prev.chart.destroy();
    }
    box.style.height = sizeFor(kind, mode, state);
    var cfg = builders[kind](box, theme(box), mode, state);
    if (state.visible) cfg.data.datasets.forEach(function (ds, i) { ds.hidden = !state.visible[i]; });
    var chart = new window.Chart(box.querySelector('canvas'), cfg);
    rendered.set(box, { chart: chart, mode: mode, kind: kind, state: state });
  }

  function fail(box, err) {
    box.classList.add('is-failed');
    if (window.console) console.warn(err);
  }

  var drawObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      drawObserver.unobserve(e.target);
      loadAll().then(function () {
        if (!board) board = readBoard();
        render(e.target);
      }).catch(function (err) { fail(e.target, err); });
    });
  }, { rootMargin: '150px 0px' });

  var warmObserver = new IntersectionObserver(function (entries) {
    if (entries.some(function (e) { return e.isIntersecting; })) {
      warmObserver.disconnect();
      loadAll().catch(function () {});
    }
  }, { rootMargin: '1000px 0px' });

  boxes.forEach(function (b) { drawObserver.observe(b); });
  warmObserver.observe(boxes[0]);

  var resizeTimer = 0;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      rendered.forEach(function (r, box) { render(box); });
    }, 150);
  });
})();
