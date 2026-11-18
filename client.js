window.__ModuleLoader__.load({
  id: 'dsh-plugin-taskbar-flash',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'taskbar-flash';
    const SCOPE = 'taskbar-flash';
    /** Host route that lists, streams and reveals user-supplied sound files. */
    const HOST = '/plugins/taskbar-flash';
    const CUSTOM_PREFIX = 'file:';

    const SOUNDS = [
      { id: 'chime' },
      { id: 'bright' },
      { id: 'soft' },
      { id: 'triple' },
      { id: 'deep' },
      { id: 'velvet' },
      { id: 'ember' },
      { id: 'resolve' },
      { id: 'system' },
      { id: 'none' },
    ];
    const SOUND_IDS_SET = new Set(SOUNDS.map((sound) => sound.id));

    /**
     * Waveform definitions mirrored from tools/generate-chime.py, so the
     * in-page preview plays exactly what the native helper plays.
     */
    const SPECS = {
      chime: {
        notes: [[880, 0.55]],
        gap: 0,
        attack: 0.012,
        decay: 6.5,
        release: 0.035,
        gain: 0.24,
        harmonics: [[1, 1], [1.5, 0.32]],
      },
      bright: {
        notes: [[1046.5, 0.16], [1318.51, 0.16], [1567.98, 0.32]],
        gap: 0.02,
        attack: 0.008,
        decay: 8,
        release: 0.02,
        gain: 0.22,
        harmonics: [[1, 1], [2, 0.18]],
      },
      soft: {
        notes: [[783.99, 0.34], [659.26, 0.44]],
        gap: 0,
        attack: 0.03,
        decay: 4.5,
        release: 0.06,
        gain: 0.2,
        harmonics: [[1, 1], [2, 0.08]],
      },
      triple: {
        notes: [[987.77, 0.1], [987.77, 0.1], [987.77, 0.1]],
        gap: 0.08,
        attack: 0.006,
        decay: 9,
        release: 0.02,
        gain: 0.22,
        harmonics: [[1, 1], [2, 0.25]],
      },
      deep: {
        notes: [[392, 0.75]],
        gap: 0,
        attack: 0.02,
        decay: 4,
        release: 0.08,
        gain: 0.26,
        harmonics: [[1, 1], [0.5, 0.5], [2, 0.12]],
      },
    };

    /**
     * Low, warm, long-tailed beds: overlapping detuned voices summed into one
     * note. Mirrors render_voices() in tools/generate-chime.py.
     */
    const VOICES = {
      velvet: {
        total: 2.3,
        voices: [
          {
            freq: 146.83, start: 0, duration: 2.3, attack: 0.02, decay: 3, release: 0.2,
            gain: 0.26, detune: 0.0018, harmonics: [[1, 1], [2, 0.22], [3, 0.06], [0.5, 0.2]],
          },
          {
            freq: 220, start: 0.12, duration: 2, attack: 0.03, decay: 3.4, release: 0.18,
            gain: 0.13, detune: 0.0012, harmonics: [[1, 1], [2, 0.14]],
          },
          {
            freq: 293.66, start: 0.26, duration: 1.7, attack: 0.05, decay: 4.2, release: 0.15,
            gain: 0.06, detune: 0.001, harmonics: [[1, 1], [2, 0.1]],
          },
        ],
      },
      ember: {
        total: 2.5,
        voices: [
          {
            freq: 130.81, start: 0, duration: 2.5, attack: 0.03, decay: 2.4, release: 0.25,
            gain: 0.3, detune: 0.002, harmonics: [[1, 1], [2, 0.2], [3, 0.05], [0.5, 0.24]],
          },
          {
            freq: 196, start: 0.16, duration: 2.2, attack: 0.05, decay: 2.8, release: 0.2,
            gain: 0.15, detune: 0.0014, harmonics: [[1, 1], [2, 0.12]],
          },
          {
            freq: 261.63, start: 0.3, duration: 1.8, attack: 0.07, decay: 3.8, release: 0.15,
            gain: 0.05, detune: 0.001, harmonics: [[1, 1], [2, 0.08]],
          },
        ],
      },
      resolve: {
        total: 2.2,
        voices: [
          {
            freq: 110, start: 0, duration: 2.2, attack: 0.02, decay: 2.8, release: 0.2,
            gain: 0.2, detune: 0.0015, harmonics: [[1, 1], [2, 0.25], [3, 0.07], [0.5, 0.12]],
          },
          {
            freq: 164.81, start: 0.18, duration: 1.95, attack: 0.03, decay: 3.2, release: 0.18,
            gain: 0.15, detune: 0.0012, harmonics: [[1, 1], [2, 0.15]],
          },
          {
            freq: 220, start: 0.36, duration: 1.7, attack: 0.04, decay: 3.6, release: 0.16,
            gain: 0.1, detune: 0.001, harmonics: [[1, 1], [2, 0.1]],
          },
        ],
      },
    };

    const RATE = 44100;
    let audioContext = null;

    function renderVoices(spec) {
      const samples = new Float32Array(Math.round(spec.total * RATE));
      for (const voice of spec.voices) {
        const offset = Math.round(voice.start * RATE);
        const frames = Math.round(voice.duration * RATE);
        const weights = voice.harmonics.reduce((sum, pair) => sum + pair[1], 0);
        const detune = voice.detune ?? 0;
        for (let frame = 0; frame < frames; frame++) {
          const t = frame / RATE;
          let envelope = Math.min(1, t / voice.attack) * Math.exp(-voice.decay * t);
          envelope *= Math.min(1, (voice.duration - t) / voice.release);
          let signal = 0;
          for (const [ratio, weight] of voice.harmonics) {
            const phase = 2 * Math.PI * voice.freq * ratio * t;
            signal += (weight * (Math.sin(phase) + Math.sin(phase * (1 + detune)))) / 2;
          }
          samples[offset + frame] += (voice.gain * envelope * signal) / weights;
        }
      }
      let peak = 0;
      for (const value of samples) peak = Math.max(peak, Math.abs(value));
      const scale = peak === 0 ? 1 : 0.28 / peak;
      for (let index = 0; index < samples.length; index++) samples[index] *= scale;
      return samples;
    }

    function render(id) {
      if (VOICES[id] !== undefined) return renderVoices(VOICES[id]);
      const spec = SPECS[id];
      if (!spec) return null;
      const total =
        spec.notes.reduce((sum, note) => sum + note[1], 0) +
        spec.gap * Math.max(0, spec.notes.length - 1);
      const samples = new Float32Array(Math.round(total * RATE));
      const weights = spec.harmonics.reduce((sum, pair) => sum + pair[1], 0);
      let offset = 0;
      for (let index = 0; index < spec.notes.length; index++) {
        if (index) offset += Math.round(spec.gap * RATE);
        const [freq, duration] = spec.notes[index];
        const frames = Math.round(duration * RATE);
        for (let frame = 0; frame < frames; frame++) {
          const t = frame / RATE;
          let envelope = Math.min(1, t / spec.attack) * Math.exp(-spec.decay * t);
          envelope *= Math.min(1, (duration - t) / spec.release);
          let signal = 0;
          for (const [ratio, weight] of spec.harmonics) {
            signal += weight * Math.sin(2 * Math.PI * freq * ratio * t);
          }
          samples[offset + frame] = (spec.gain * envelope * signal) / weights;
        }
        offset += frames;
      }
      return samples;
    }

    function label(t, id) {
      if (typeof id === 'string' && id.startsWith(CUSTOM_PREFIX)) return id.slice(CUSTOM_PREFIX.length);
      return t(`sound_${id}`);
    }

    const LANGUAGE_KEY = `${NS}.language`;
    const languageListeners = new Set();
    let languageOverride;
    function getLanguageOverride() {
      if (languageOverride !== undefined) return languageOverride;
      languageOverride = null;
      try {
        const stored = window.localStorage.getItem(LANGUAGE_KEY);
        if (stored === 'zh' || stored === 'en') languageOverride = stored;
      } catch { /* use the host language until the user switches */ }
      return languageOverride;
    }
    const subscribeLanguage = (listener) => {
      languageListeners.add(listener);
      return () => { languageListeners.delete(listener); };
    };
    function setPanelLanguage(language) {
      languageOverride = language;
      try { window.localStorage.setItem(LANGUAGE_KEY, language); } catch { /* keep the session choice */ }
      for (const listener of languageListeners) listener();
    }

    const zh = {
      languageId: 'zh',
      switchLanguage: '将提示音设置切换到英文',
      completionLabel: '完成提示音',
      attentionLabel: '等待批准提示音',
      sound_same: '同完成提示音',
      builtInGroup: '内置提示音',
      stop: '停止',
      folderFailed: '打开声音文件夹失败，请按下方路径手动打开。',
      trimTitle: '自制提示音台',
      trimChoose: '选择音频',
      trimDrop: '也可将音频拖到这里（最多 32 MB）',
      trimDecoding: '正在读取音频…',
      trimFileSize: '请选择非空且不超过 32 MB 的音频。',
      trimSourceLength: '原音频最长支持 10 分钟。',
      trimDecodeError: '读取失败，请试试 WAV、MP3 或其他浏览器支持的格式。',
      trimStart: '起点',
      trimEnd: '终点',
      trimLength: '选段时长',
      trimTooLong: '提示音最长 15 秒，请缩短选段。',
      trimPlay: '试听选段',
      trimReset: '恢复全长',
      trimName: '提示音名称',
      trimSave: '截取并加入自定义提示音',
      trimSaveError: '保存失败，请检查声音文件夹后重试。',
      trimSaved: '已加入自定义提示音：',
      trimSavedHint: '可在上方任一菜单的「自定义声音」里选用。',
      title: '任务栏闪烁及提示音',
      summary: '提示音',
      summarySeparator: '：',
      description:
        '分别设置完成和等待批准时的提示音。等待回答也使用批准提示音。DSH 在后台时会同时闪烁任务栏。',
      soundLabel: '提示音',
      preview: '试听',
      previewing: '播放中…',
      systemHint: '系统提示音由 Windows 播放，页面上无法试听。',
      noneHint: '已选择静音，只闪烁任务栏。',
      volumeHint: '实际音量由 Windows 音量与静音状态决定。',
      sound_chime: '经典双音',
      sound_bright: '清脆上行',
      sound_soft: '柔和下行',
      sound_triple: '三连提醒',
      sound_deep: '低沉钟声',
      sound_velvet: '温暖低钟',
      sound_ember: '厚重低鸣',
      sound_resolve: '低沉完成音',
      sound_system: 'Windows 系统提示音',
      sound_none: '静音（只闪烁任务栏）',
      customGroup: '自定义声音',
      customEmpty: '文件夹还是空的',
      customHint: '点「添加提示音」直接选文件，或把 wav / mp3 / m4a / ogg / flac / wma 放进文件夹再刷新；单个文件上限 12 MB，播放最长 15 秒。',
      addSound: '添加提示音',
      adding: '正在添加…',
      addSaved: '已加入自定义提示音：',
      addRejected: '这些文件没能添加（类型不支持、超过 12 MB 或写入失败）：',
      addFailed: '添加失败，请检查声音文件夹后重试。',
      versionLabel: '插件版本',
      customDirLabel: '声音文件夹',
      openFolder: '打开文件夹',
      refresh: '刷新列表',
      refreshing: '刷新中…',
      missingSound: '选中的文件已不存在，将播放',
      customLoadFailed: '读不到自定义声音列表。',
      previewFailed: '试听失败，检查文件是否可播放。',
      missingOption: '（文件缺失）',
      save: '保存',
      saving: '保存中…',
      saved: '已保存',
      failed: '保存失败，请重试',
      readOnly: '当前部署只读',
      unavailable: '设置尚未就绪',
    };

    const en = {
      languageId: 'en',
      switchLanguage: 'Switch reminder settings to Chinese',
      completionLabel: 'Completion sound',
      attentionLabel: 'Pending approval sound',
      sound_same: 'Same as completion sound',
      builtInGroup: 'Built-in sounds',
      stop: 'Stop',
      folderFailed: 'Could not open the sound folder. Open the path below manually.',
      trimTitle: 'Make a reminder sound',
      trimChoose: 'Choose audio',
      trimDrop: 'Or drop an audio file here (up to 32 MB)',
      trimDecoding: 'Reading audio…',
      trimFileSize: 'Choose a nonempty audio file up to 32 MB.',
      trimSourceLength: 'Source audio can be up to 10 minutes long.',
      trimDecodeError: 'Could not read the audio. Try WAV, MP3, or another browser-supported format.',
      trimStart: 'Start',
      trimEnd: 'End',
      trimLength: 'Selection length',
      trimTooLong: 'Shorten the selection to 15 seconds or less.',
      trimPlay: 'Play selection',
      trimReset: 'Reset to full length',
      trimName: 'Sound name',
      trimSave: 'Trim and add to custom sounds',
      trimSaveError: 'Could not save the clip. Check the sound folder and try again.',
      trimSaved: 'Added to your custom sounds: ',
      trimSavedHint: 'Pick it from Your own sounds in either menu above.',
      title: 'Taskbar Flash & Sounds',
      summary: 'Sound',
      summarySeparator: ': ',
      description:
        'Choose a sound for completion and another for pending approval. Questions use the approval sound. The taskbar also flashes while DSH is in the background.',
      soundLabel: 'Sound',
      preview: 'Preview',
      previewing: 'Playing…',
      systemHint: 'The Windows system sound is played by Windows and cannot be previewed here.',
      noneHint: 'Silent: only the taskbar flashes.',
      volumeHint: 'Actual volume follows the Windows volume and mute state.',
      sound_chime: 'Classic chime',
      sound_bright: 'Bright ascending',
      sound_soft: 'Soft descending',
      sound_triple: 'Triple blip',
      sound_deep: 'Deep bell',
      sound_velvet: 'Warm low bell',
      sound_ember: 'Deep hum',
      sound_resolve: 'Low completion',
      sound_system: 'Windows system sound',
      sound_none: 'Silent (taskbar only)',
      customGroup: 'Your own sounds',
      customEmpty: 'The folder is still empty',
      customHint: 'Click Add sound to pick files, or drop wav / mp3 / m4a / ogg / flac / wma into the folder and refresh. Up to 12 MB per file, 15 seconds of playback.',
      addSound: 'Add sound',
      adding: 'Adding…',
      addSaved: 'Added to your custom sounds: ',
      addRejected: 'These files were not added (unsupported type, over 12 MB, or the write failed): ',
      addFailed: 'Could not add the files. Check the sound folder and try again.',
      versionLabel: 'Plugin version',
      customDirLabel: 'Sound folder',
      openFolder: 'Open folder',
      refresh: 'Refresh list',
      refreshing: 'Refreshing…',
      missingSound: 'The selected file is missing. Instead, reminders play',
      customLoadFailed: 'Cannot read the custom sound list.',
      previewFailed: 'Preview failed; check that the file is playable.',
      missingOption: ' (missing)',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved',
      failed: 'Save failed; try again',
      readOnly: 'This deployment is read-only',
      unavailable: 'Settings are not ready',
    };

    const styles = {
      studio: { border: '1px solid var(--dsw-alias-border-l4)', borderRadius: 8, padding: '10px 12px' },
      summary: { color: 'var(--dsw-alias-label-primary)', fontSize: 13, fontWeight: 600, cursor: 'pointer', paddingBlock: 3 },
      drop: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: 9, marginTop: 6,
        overflowWrap: 'anywhere', border: '1px dashed var(--dsw-alias-border-l4)', borderRadius: 7 },
      timeline: { display: 'grid', gap: 3, marginBlock: 5 },
      timelineTrack: { position: 'relative', height: 6, borderRadius: 99, overflow: 'hidden',
        background: 'var(--dsw-alias-bg-layer-3)', border: '1px solid var(--dsw-alias-border-l4)' },
      timelineSelection: { position: 'absolute', top: 0, height: '100%', background: 'var(--dsw-alias-label-secondary)' },
      timelineRow: { display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr) max-content',
        alignItems: 'center', gap: 8, color: 'var(--dsw-alias-label-secondary)', fontSize: 12 },
      time: { fontVariantNumeric: 'tabular-nums', color: 'var(--dsw-alias-label-secondary)', fontSize: 12 },
      slider: { width: '100%', margin: 0, height: 24, accentColor: 'var(--dsw-alias-label-secondary)' },
      input: { height: 32, paddingInline: 8, borderRadius: 7, font: 'inherit',
        background: 'var(--dsw-alias-bg-layer-3)', border: '1px solid var(--dsw-alias-border-l4)',
        color: 'var(--dsw-alias-label-primary)' },
      primary: { fontWeight: 600 },
      wrap: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '4px 0 8px' },
      desc: { margin: 0, color: 'var(--dsw-alias-label-secondary)', fontSize: '13px', lineHeight: '20px' },
      field: { display: 'flex', flexDirection: 'column', gap: '6px' },
      label: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' },
      row: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
      select: {
        height: '36px',
        width: 'min(320px, 100%)',
        minWidth: 0,
        maxWidth: '100%',
        padding: '0 10px',
        borderRadius: '8px',
        border: '0.5px solid var(--dsw-alias-border-l4)',
        background: 'var(--dsw-alias-bg-layer-3)',
        color: 'var(--dsw-alias-label-primary)',
        font: 'inherit',
        fontSize: '13px',
      },
      button: {
        height: '32px',
        padding: '0 14px',
        borderRadius: '8px',
        border: '0.5px solid var(--dsw-alias-border-l4)',
        background: 'var(--dsw-alias-bg-layer-3)',
        color: 'var(--dsw-alias-label-primary)',
        font: 'inherit',
        fontSize: '13px',
        cursor: 'pointer',
      },
      hint: { margin: 0, fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' },
      path: {
        margin: 0,
        fontSize: '12px',
        color: 'var(--dsw-alias-label-tertiary)',
        fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
        wordBreak: 'break-all',
      },
      status: { margin: 0, fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' },
      error: { margin: 0, fontSize: '12px', color: 'var(--dsw-alias-state-error-primary)' },
      notice: { margin: 0, fontSize: '12px', color: 'var(--dsw-alias-state-success-primary)' },
    };

    const MAX_TRIM_SECONDS = 15;
    const TRIM_RATE = 44100;
    const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
    /** Same ceiling the Host enforces for files dropped into the sound folder. */
    const MAX_CUSTOM_BYTES = 12 * 1024 * 1024;
    const AUDIO_NAME = /\.(wav|mp3|m4a|ogg|flac|wma)$/i;

    function encodeTrim(buffer, start, end) {
      const channels = Math.min(2, buffer.numberOfChannels);
      const offset = Math.round(start * TRIM_RATE);
      const finish = Math.min(buffer.length, Math.round(end * TRIM_RATE));
      const frames = Math.min(finish - offset, TRIM_RATE * MAX_TRIM_SECONDS);
      const bytes = frames * channels * 2;
      const wav = new ArrayBuffer(44 + bytes);
      const out = new DataView(wav);
      const tag = (at, value) => {
        for (let i = 0; i < value.length; i++) out.setUint8(at + i, value.charCodeAt(i));
      };
      tag(0, 'RIFF'); tag(8, 'WAVE'); tag(12, 'fmt '); tag(36, 'data');
      out.setUint32(4, 36 + bytes, true);
      out.setUint32(16, 16, true);
      out.setUint16(20, 1, true);
      out.setUint16(22, channels, true);
      out.setUint32(24, TRIM_RATE, true);
      out.setUint32(28, TRIM_RATE * channels * 2, true);
      out.setUint16(32, channels * 2, true);
      out.setUint16(34, 16, true);
      out.setUint32(40, bytes, true);
      const samples = Array.from({ length: channels }, (_, n) => buffer.getChannelData(n));
      for (let i = 0; i < frames; i++) {
        for (let n = 0; n < channels; n++) {
          const sample = Math.max(-1, Math.min(1, samples[n][offset + i]));
          out.setInt16(44 + (i * channels + n) * 2, sample * (sample < 0 ? 32768 : 32767), true);
        }
      }
      return wav;
    }

    function timeLabel(seconds) {
      const centiseconds = Math.round(seconds * 100);
      const minutes = Math.floor(centiseconds / 6000);
      const remainder = ((centiseconds % 6000) / 100).toFixed(2).padStart(5, '0');
      return `${minutes}:${remainder}`;
    }

    function startBuffer(buffer, start, length, done, fail) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!audioContext) audioContext = new AudioContextClass();
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      source.onended = done;
      source.start(0, start, length);
      if (audioContext.state !== 'running') audioContext.resume().catch(fail);
      return () => {
        source.onended = null;
        try { source.stop(); } catch { /* already finished */ }
        source.disconnect();
      };
    }

    function button(text, onClick, disabled = false, kind = '') {
      return h('button', {
        type: 'button', disabled, onClick,
        style: { ...styles.button, ...(kind === 'primary' ? styles.primary : {}),
          opacity: disabled ? 0.5 : 1, cursor: disabled ? 'default' : 'pointer' },
      }, text);
    }

    function TrimStudio({ t, play, stop, playing, onAdded, writable }) {
      const [clip, setClip] = React.useState(null);
      const [start, setStart] = React.useState(0);
      const [end, setEnd] = React.useState(0);
      const [title, setTitle] = React.useState('');
      const [loading, setLoading] = React.useState(false);
      const [saving, setSaving] = React.useState(false);
      const [dragging, setDragging] = React.useState(false);
      const [error, setError] = React.useState('');
      const [saved, setSaved] = React.useState('');
      const request = React.useRef(0);
      const input = React.useRef(null);
      React.useEffect(() => () => { request.current++; }, []);
      // A saved clip announces itself, then gets out of the way.
      React.useEffect(() => {
        if (!saved) return undefined;
        const timer = setTimeout(() => setSaved(''), 8000);
        return () => clearTimeout(timer);
      }, [saved]);

      const load = async (file) => {
        if (!file || saving) return;
        const id = ++request.current;
        stop();
        setClip(null);
        setError('');
        setSaved('');
        if (!file.size || file.size > MAX_SOURCE_BYTES) {
          setLoading(false);
          setError('trimFileSize');
          return;
        }
        setLoading(true);
        try {
          const decoder = new OfflineAudioContext(1, 1, TRIM_RATE);
          const buffer = await decoder.decodeAudioData(await file.arrayBuffer());
          if (request.current !== id) return;
          if (!buffer.length || buffer.duration > 600) throw new Error('duration');
          setClip({ buffer, name: file.name });
          setStart(0);
          setEnd(buffer.duration);
          setTitle(file.name.replace(/\.[^.]+$/, '').slice(0, 52));
        } catch (cause) {
          if (request.current === id) setError(cause.message === 'duration' ? 'trimSourceLength' : 'trimDecodeError');
        } finally {
          if (request.current === id) setLoading(false);
        }
      };

      const length = end - start;
      const duration = clip?.buffer.duration ?? 0;
      const tooLong = length > MAX_TRIM_SECONDS + 1e-8;
      const minLength = Math.min(0.01, duration);
      const adjust = (which, value) => {
        if (playing === 'trim') stop();
        if (which === 'start') setStart(Math.max(0, Math.min(value, end - minLength)));
        else setEnd(Math.min(duration, Math.max(value, start + minLength)));
        setSaved('');
        setError('');
      };
      const save = async () => {
        if (!clip || saving || !writable || tooLong || length < 1 / TRIM_RATE) return;
        setSaving(true);
        setError('');
        setSaved('');
        try {
          const response = await fetch(`${HOST}/trim?${new URLSearchParams({ title })}`, {
            method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-DSH-Sound-Action': 'save-trim' },
            body: encodeTrim(clip.buffer, start, end),
          });
          if (!response.ok) throw new Error(String(response.status));
          const entry = await response.json();
          if (typeof entry?.name !== 'string') throw new Error('name');
          onAdded(entry);
          setSaved(entry.name);
        } catch {
          setError('trimSaveError');
        } finally {
          setSaving(false);
        }
      };
      const timelineRow = (which, key, value) => h('label', { style: styles.timelineRow },
        h('span', null, t(key)),
        h('input', { type: 'range', min: 0, max: duration, step: 'any', value,
          'aria-valuetext': timeLabel(value), style: styles.slider, disabled: saving,
          onChange: (event) => adjust(which, Number(event.target.value)) }),
        h('span', { style: styles.time }, timeLabel(value)));

      return h('details', { style: styles.studio, onToggle: (event) => {
        if (!event.currentTarget.open && playing === 'trim') stop();
      } },
        h('summary', { style: styles.summary }, t('trimTitle')),
        h('div', { style: styles.field },
          h('div', {
            style: { ...styles.drop, background: dragging ? 'var(--dsw-alias-bg-layer-3)' : undefined },
            onDragOver: (event) => { event.preventDefault(); if (!saving) setDragging(true); },
            onDragLeave: () => setDragging(false),
            onDrop: (event) => {
              event.preventDefault(); event.stopPropagation(); setDragging(false);
              load(event.dataTransfer.files[0]);
            },
          },
            h('input', { type: 'file', ref: input, hidden: true,
              accept: 'audio/*,.wav,.mp3,.m4a,.ogg,.flac,.wma,.aac,.opus',
              onChange: (event) => { const file = event.target.files[0]; event.target.value = ''; load(file); } }),
            button(t('trimChoose'), () => input.current?.click(), saving),
            h('span', { style: styles.hint }, loading ? t('trimDecoding') : (clip?.name ?? t('trimDrop'))),
          ),
          clip ? h(React.Fragment, null,
            h('div', { style: styles.timeline },
              h('div', { style: styles.timelineTrack, 'aria-hidden': true },
                h('div', { style: { ...styles.timelineSelection, left: `${start / duration * 100}%`,
                  width: `${length / duration * 100}%` } })),
              h('div', { style: { ...styles.row, justifyContent: 'space-between' }, 'aria-hidden': true },
                h('span', { style: styles.time }, timeLabel(0)), h('span', { style: styles.time }, timeLabel(duration))),
              timelineRow('start', 'trimStart', start),
              timelineRow('end', 'trimEnd', end),
            ),
            h('p', { style: styles.status }, `${t('trimLength')} ${timeLabel(length)}`),
            tooLong ? h('p', { style: styles.error }, t('trimTooLong')) : null,
            h('div', { style: styles.row },
              button(t(playing === 'trim' ? 'stop' : 'trimPlay'), () => {
                if (playing === 'trim') stop();
                else {
                  setError('');
                  play('trim', (done, fail) => startBuffer(clip.buffer, start, length, done, fail),
                    () => setError('previewFailed'));
                }
              }, saving),
              button(t('trimReset'), () => {
                if (playing === 'trim') stop();
                setStart(0); setEnd(duration); setSaved(''); setError('');
              }, saving || (start === 0 && end === duration)),
            ),
            h('label', { style: styles.field }, h('span', { style: styles.label }, t('trimName')),
              h('input', { style: styles.input, type: 'text', value: title, maxLength: 52, disabled: saving,
                onChange: (event) => { setTitle(event.target.value); setSaved(''); } })),
            h('div', { style: styles.row }, button(t(saving ? 'saving' : 'trimSave'), save,
              !writable || saving || tooLong || length < 1 / TRIM_RATE, 'primary')),
          ) : null,
          error ? h('p', { style: styles.error, role: 'alert' }, t(error)) : null,
          saved ? h('div', { style: styles.notice, role: 'status' },
            h('p', { style: styles.notice }, `${t('trimSaved')}${saved}`),
            h('p', { style: styles.notice }, t('trimSavedHint')),
          ) : null,
        ),
      );
    }

    function SoundCard(props) {
      const { scope, view } = props;
      const override = React.useSyncExternalStore(subscribeLanguage, getLanguageOverride);
      const language = override ?? (props.t?.('languageId') === 'zh' ? 'zh' : 'en');
      const targetLanguage = language === 'zh' ? 'en' : 'zh';
      const targetLabel = targetLanguage === 'en' ? 'English' : '中文';
      const strings = language === 'zh' ? zh : en;
      const t = (key) => strings[key] ?? en[key] ?? key;
      const completionLabelId = React.useId();
      const approvalLabelId = React.useId();
      const [snapshot, setSnapshot] = React.useState(() => scope.getSnapshot());
      React.useEffect(() => scope.subscribe(() => setSnapshot(scope.getSnapshot())), [scope]);
      const currentSound = snapshot?.value?.sound ?? 'ember';
      const currentAttention = snapshot?.value?.attentionSound ?? 'triple';
      const [draftSound, setDraftSound] = React.useState(null);
      const [draftAttention, setDraftAttention] = React.useState(null);
      const completion = draftSound ?? currentSound;
      const attention = draftAttention ?? currentAttention;
      const [customs, setCustoms] = React.useState([]);
      const [customDir, setCustomDir] = React.useState('');
      const [version, setVersion] = React.useState('');
      const [listing, setListing] = React.useState(false);
      const [listed, setListed] = React.useState(false);
      const [listingFailed, setListingFailed] = React.useState(false);
      const [folderFailed, setFolderFailed] = React.useState(false);
      const [previewFailed, setPreviewFailed] = React.useState('');
      const [playing, setPlaying] = React.useState('');
      const [saving, setSaving] = React.useState(false);
      const [saveState, setSaveState] = React.useState('');
      const [adding, setAdding] = React.useState(false);
      const [addNote, setAddNote] = React.useState('');
      const [addFailed, setAddFailed] = React.useState(false);
      const fileInput = React.useRef(null);
      // Added-file feedback clears itself; failures stay a little longer to be read.
      React.useEffect(() => {
        if (!addNote) return undefined;
        const timer = setTimeout(() => setAddNote(''), addFailed ? 12000 : 8000);
        return () => clearTimeout(timer);
      }, [addNote, addFailed]);
      React.useEffect(() => {
        if (!saveState) return undefined;
        const timer = setTimeout(() => setSaveState(''), 6000);
        return () => clearTimeout(timer);
      }, [saveState]);
      const player = React.useRef(null);
      const revision = React.useRef(0);

      const loadCustoms = React.useCallback(async () => {
        const stamp = ++revision.current;
        setListing(true);
        try {
          const response = await fetch(`${HOST}/sounds`, { cache: 'no-store' });
          if (!response.ok) throw new Error(String(response.status));
          const data = await response.json();
          if (stamp !== revision.current) return;
          setCustoms(Array.isArray(data?.sounds) ? data.sounds : []);
          setCustomDir(typeof data?.dir === 'string' ? data.dir : '');
          setVersion(typeof data?.version === 'string' ? data.version : '');
          setListed(true);
          setListingFailed(false);
        } catch {
          if (stamp === revision.current) setListingFailed(true);
        } finally {
          if (stamp === revision.current) setListing(false);
        }
      }, []);
      React.useEffect(() => {
        if (view !== 'summary') loadCustoms();
        return () => { revision.current++; };
      }, [loadCustoms, view]);

      const release = () => {
        const active = player.current;
        player.current = null;
        active?.cleanup?.();
      };
      const stop = () => { release(); setPlaying(''); };
      React.useEffect(() => () => { release(); }, []);
      const play = (kind, startPlay, onError) => {
        release();
        setPreviewFailed('');
        setPlaying(kind);
        const active = {};
        player.current = active;
        const done = (failed) => {
          if (player.current !== active) return;
          stop();
          if (failed) onError();
        };
        try { active.cleanup = startPlay(() => done(false), () => done(true)); }
        catch { done(true); }
      };
      const previewSound = (kind, id) => play(kind, (done, fail) => {
        if (id.startsWith(CUSTOM_PREFIX)) {
          const element = new Audio(`${HOST}/sound/${encodeURIComponent(id.slice(CUSTOM_PREFIX.length))}`);
          element.onended = done;
          element.onerror = fail;
          element.play().catch(fail);
          return () => { element.onended = null; element.onerror = null; element.pause(); element.removeAttribute('src'); element.load(); };
        }
        const samples = render(id);
        if (!samples) throw new Error('sound');
        const buffer = new AudioBuffer({ length: samples.length, numberOfChannels: 1, sampleRate: RATE });
        buffer.copyToChannel(samples, 0);
        return startBuffer(buffer, 0, buffer.duration, done, fail);
      }, () => setPreviewFailed(kind));

      if (view === 'summary') {
        return `${t('completionLabel')}${t('summarySeparator')}${label(t, currentSound)} · ${t('attentionLabel')}${t('summarySeparator')}${label(t, currentAttention)}`;
      }
      const ready = snapshot?.status === 'ready';
      const writable = snapshot?.writable === true;
      const customIds = new Set(customs.map((entry) => CUSTOM_PREFIX + entry.name));
      const dirty = completion !== currentSound || attention !== currentAttention;
      const save = async () => {
        if (saving || !ready || !writable || !dirty) return;
        setSaving(true);
        setSaveState('');
        try {
          const ops = [];
          if (completion !== currentSound) ops.push({ op: 'set', path: ['sound'], value: completion });
          if (attention !== currentAttention) ops.push({ op: 'set', path: ['attentionSound'], value: attention });
          await scope.mutate(ops, snapshot.revision);
          setSnapshot(scope.getSnapshot());
          setDraftSound(null);
          setDraftAttention(null);
          setSaveState('saved');
        } catch { setSaveState('failed'); }
        finally { setSaving(false); }
      };
      const openFolder = async () => {
        setFolderFailed(false);
        try {
          const response = await fetch(`${HOST}/open-folder`, {
            method: 'POST', headers: { 'X-DSH-Sound-Action': 'open-folder' },
          });
          if (!response.ok) throw new Error(String(response.status));
        } catch { setFolderFailed(true); }
      };
      /** Copies picked files into the sound folder through the Host route, then refreshes both menus. */
      const addFiles = async (picked) => {
        // The caller hands over a plain array: reading `input.files` after the input is
        // cleared yields an empty list, so the conversion has to happen first.
        const files = Array.isArray(picked) ? picked : Array.from(picked || []);
        if (adding || !files.length) return;
        setAdding(true);
        setAddNote('');
        setAddFailed(false);
        const added = [];
        const rejected = [];
        for (const file of files) {
          if (!file.size) { rejected.push(`${file.name} (0 B)`); continue; }
          if (file.size > MAX_CUSTOM_BYTES) { rejected.push(`${file.name} (>12 MB)`); continue; }
          if (!AUDIO_NAME.test(file.name)) { rejected.push(`${file.name} (type)`); continue; }
          try {
            const response = await fetch(`${HOST}/add?${new URLSearchParams({ name: file.name })}`, {
              method: 'POST',
              headers: { 'content-type': 'application/octet-stream', 'x-dsh-sound-action': 'add-sound' },
              body: file,
            });
            const data = await response.json().catch(() => null);
            if (!response.ok || !data?.name) {
              rejected.push(`${file.name} (${response.status}${data?.error ? ` ${data.error}` : ''})`);
            } else added.push(data.name);
          } catch (cause) {
            rejected.push(`${file.name} (${cause?.message || 'network'})`);
          }
        }
        setAdding(false);
        if (added.length) {
          setCustoms((current) => {
            const merged = new Map(current.map((entry) => [entry.name, entry]));
            for (const name of added) merged.set(name, { name, bytes: 0 });
            return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
          });
          loadCustoms();
        }
        const joiner = language === 'zh' ? '、' : ', ';
        if (rejected.length) {
          setAddFailed(true);
          setAddNote(`${t('addRejected')}${rejected.join(joiner)}`);
        } else {
          setAddNote(`${t('addSaved')}${added.join(joiner)}`);
        }
      };

      const picker = (kind, heading, labelId, value, update, fallback) => {
        const inherited = kind === 'attention' && value === 'same';
        const effective = inherited ? completion : value;
        const custom = effective.startsWith(CUSTOM_PREFIX);
        const missing = listed && !listingFailed && custom && !customIds.has(effective);
        const known = value === 'same' || SOUND_IDS_SET.has(value) || customIds.has(value);
        const playable = (SOUND_IDS_SET.has(effective) || customIds.has(effective))
          && effective !== 'system' && effective !== 'none';
        return h('div', { style: styles.field },
          h('label', { htmlFor: labelId, style: styles.label }, t(heading)),
          h('div', { style: styles.row },
            h('select', { id: labelId, style: styles.select, value, disabled: !writable || saving,
              onChange: (event) => { stop(); update(event.target.value); setSaveState(''); setPreviewFailed(''); } },
              kind === 'attention' ? h('option', { value: 'same' }, t('sound_same')) : null,
              !known ? h('option', { value }, `${custom ? label(t, value) : value}${missing ? t('missingOption') : ''}`) : null,
              h('optgroup', { label: t('builtInGroup') }, SOUNDS.map(({ id }) =>
                h('option', { key: id, value: id }, label(t, id)))),
              h('optgroup', { label: t('customGroup') }, customs.length ? customs.map(({ name }) =>
                h('option', { key: name, value: CUSTOM_PREFIX + name }, name)) :
                h('option', { value: '__empty', disabled: true }, t('customEmpty'))),
            ),
            button(t(playing === kind ? 'stop' : 'preview'), () => {
              if (playing === kind) stop(); else previewSound(kind, effective);
            }, !playable),
          ),
          inherited ? h('p', { style: styles.hint }, `${t('sound_same')}${t('summarySeparator')}${label(t, completion)}`) : null,
          missing ? h('p', { style: styles.error }, `${t('missingSound')} ${label(t, fallback)}`) : null,
          effective === 'system' ? h('p', { style: styles.hint }, t('systemHint')) : null,
          effective === 'none' ? h('p', { style: styles.hint }, t('noneHint')) : null,
          previewFailed === kind ? h('p', { style: styles.error, role: 'alert' }, t('previewFailed')) : null,
        );
      };

      return h('div', { style: styles.wrap, lang: language },
        h('div', { style: { ...styles.row, justifyContent: 'space-between' } },
          version ? h('span', { style: styles.path, title: t('versionLabel') }, `v${version}`) : h('span', null),
          h('button', { type: 'button', style: styles.button,
            'aria-label': `${targetLabel} — ${t('switchLanguage')}`,
            onClick: () => setPanelLanguage(targetLanguage) },
            h('span', { lang: targetLanguage }, targetLabel))),
        h('p', { style: styles.desc }, t('description')),
        !ready ? h('p', { style: styles.status }, t('unavailable')) : h(React.Fragment, null,
          picker('completion', 'completionLabel', completionLabelId, completion, setDraftSound, 'ember'),
          picker('attention', 'attentionLabel', approvalLabelId, attention, setDraftAttention, attention === 'same' ? 'ember' : 'triple'),
          h('div', { style: styles.row },
            button(t(saving ? 'saving' : 'save'), save, !writable || saving || !dirty, 'primary'),
            saveState ? h('span', { role: saveState === 'failed' ? 'alert' : 'status',
              style: saveState === 'failed' ? styles.error : styles.notice }, t(saveState)) : null,
            !writable ? h('p', { style: styles.status }, t('readOnly')) : null,
          ),
          h(TrimStudio, { t, playing, play, stop, writable: writable && listed && !listingFailed,
            onAdded: (entry) => {
              setCustoms((current) => current.some(({ name }) => name === entry.name)
                ? current : [...current, entry].sort((a, b) => a.name.localeCompare(b.name)));
              loadCustoms();
            } }),
          h('div', { style: styles.row },
            h('input', {
              ref: fileInput, type: 'file', multiple: true, tabIndex: -1,
              accept: '.wav,.mp3,.m4a,.ogg,.flac,.wma,audio/*',
              style: { display: 'none' }, 'aria-hidden': 'true',
              onChange: (event) => {
                const picked = Array.from(event.target.files ?? []);
                event.target.value = '';
                addFiles(picked);
              },
            }),
            button(t(adding ? 'adding' : 'addSound'), () => fileInput.current?.click(), !writable || adding),
            button(t('openFolder'), openFolder, !writable),
            button(t(listing ? 'refreshing' : 'refresh'), loadCustoms, listing),
          ),
          addNote ? h('p', { role: addFailed ? 'alert' : 'status',
            style: addFailed ? styles.error : styles.notice }, addNote) : null,
          h('p', { style: styles.hint }, t('customHint')),
          customDir ? h('p', { style: styles.path }, customDir) : null,
          folderFailed ? h('p', { style: styles.error, role: 'alert' }, t('folderFailed')) : null,
          listingFailed ? h('p', { style: styles.error, role: 'alert' }, t('customLoadFailed')) : null,
        ),
      );
    }

    return {
      inject: ['slots', 'locale', 'configForms'],
      apply(ctx) {
        const t = ctx.locale.bind(NS);
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'taskbar-flash: dictionaries');

        const scope = ctx.configForms.get(SCOPE);
        ctx.effect(
          () =>
            ctx.configForms.whileServed([SCOPE], () =>
              ctx.slots.inject('plugins.item', () =>
                ctx.slots.register(
                  {
                    name: 'plugins.item',
                    id: SCOPE,
                    order: 12,
                    label: () => t('title'),
                    locale: NS,
                    inject: () => ({ scope, t }),
                  },
                  SoundCard,
                ),
              ),
            ),
          'taskbar-flash: settings card',
        );
      },
    };
  },
});
