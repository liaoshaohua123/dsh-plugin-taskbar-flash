"""Generate the original, redistributable DSH reminder sounds using stdlib only.

Every sound is a short mono PCM16 chime built from sine partials with an
exponential decay. The five files are the built-in choices the plugin's
settings select offers; the waveform math is mirrored by client.js so the
in-page preview matches what ``PlaySoundW`` plays.
"""
from pathlib import Path
import array
import math
import struct
import wave

RATE = 44100
ROOT = Path(__file__).resolve().parents[1]
CHIME = ROOT / "reminder.wav"
SOUND_DIR = ROOT / "sounds"


def tone(freq, duration, attack, decay, release, gain, harmonics):
    """One note: linear attack, exponential decay, linear release."""
    frames = bytearray()
    weights = sum(weight for _, weight in harmonics)
    for index in range(round(RATE * duration)):
        t = index / RATE
        envelope = min(1.0, t / attack) * math.exp(-decay * t)
        envelope *= min(1.0, (duration - t) / release)
        signal = sum(weight * math.sin(2 * math.pi * freq * ratio * t)
                     for ratio, weight in harmonics)
        frames.extend(struct.pack("<h", round(32767 * gain * envelope * signal / weights)))
    return frames


def render(notes, gap, **shape):
    """Concatenate notes with a silent gap between them."""
    frames = bytearray()
    for index, (freq, duration) in enumerate(notes):
        if index:
            frames.extend(b"\x00\x00" * round(RATE * gap))
        frames.extend(tone(freq, duration, **shape))
    return frames


def write(path, frames):
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(RATE)
        audio.writeframes(frames)
    print(f"{path.relative_to(ROOT)}: {len(frames) / 2 / RATE:.2f}s, mono PCM16, {RATE}Hz")


# The default chime is intentionally byte-identical to the original reminder
# so upgrading keeps the sound people already know.
write(CHIME, render([(880, 0.55)], 0, attack=0.012, decay=6.5, release=0.035,
                    gain=0.24, harmonics=[(1, 1.0), (1.5, 0.32)]))

write(SOUND_DIR / "bright.wav", render(
    [(1046.50, 0.16), (1318.51, 0.16), (1567.98, 0.32)], 0.02,
    attack=0.008, decay=8.0, release=0.02, gain=0.22,
    harmonics=[(1, 1.0), (2, 0.18)]))

write(SOUND_DIR / "soft.wav", render(
    [(783.99, 0.34), (659.26, 0.44)], 0.0,
    attack=0.03, decay=4.5, release=0.06, gain=0.20,
    harmonics=[(1, 1.0), (2, 0.08)]))

write(SOUND_DIR / "triple.wav", render(
    [(987.77, 0.10), (987.77, 0.10), (987.77, 0.10)], 0.08,
    attack=0.006, decay=9.0, release=0.02, gain=0.22,
    harmonics=[(1, 1.0), (2, 0.25)]))

write(SOUND_DIR / "deep.wav", render(
    [(392.00, 0.75)], 0.0,
    attack=0.02, decay=4.0, release=0.08, gain=0.26,
    harmonics=[(1, 1.0), (0.5, 0.5), (2, 0.12)]))


def render_voices(total, voices, peak=0.28):
    """Mix overlapping low voices into one warm, long-tailed note bed.

    Each voice is two slightly detuned copies of the same partial stack, which
    gives the slow beating that reads as "thick" without adding noise. The mix
    is normalised so every new sound has the same peak level.
    """
    mix = [0.0] * round(RATE * total)
    for voice in voices:
        offset = round(RATE * voice["start"])
        length = round(RATE * voice["duration"])
        weights = sum(weight for _, weight in voice["harmonics"])
        detune = voice.get("detune", 0.0)
        for index in range(length):
            t = index / RATE
            envelope = min(1.0, t / voice["attack"]) * math.exp(-voice["decay"] * t)
            envelope *= min(1.0, (voice["duration"] - t) / voice["release"])
            signal = 0.0
            for ratio, weight in voice["harmonics"]:
                phase = 2 * math.pi * voice["freq"] * ratio * t
                signal += weight * (math.sin(phase) + math.sin(phase * (1 + detune))) / 2
            mix[offset + index] += voice["gain"] * envelope * signal / weights
    scale = peak / max(abs(value) for value in mix)
    samples = array.array("h", (round(32767 * scale * value) for value in mix))
    return samples.tobytes()


# Three low, warm completion chimes. They favour fundamentals around 110-150 Hz
# with long decays, so they feel rounded and calm rather than bright.
write(SOUND_DIR / "velvet.wav", render_voices(2.3, [
    {"freq": 146.83, "start": 0.00, "duration": 2.30, "attack": 0.020, "decay": 3.0,
     "release": 0.20, "gain": 0.26, "detune": 0.0018,
     "harmonics": [(1, 1.0), (2, 0.22), (3, 0.06), (0.5, 0.20)]},
    {"freq": 220.00, "start": 0.12, "duration": 2.00, "attack": 0.030, "decay": 3.4,
     "release": 0.18, "gain": 0.13, "detune": 0.0012,
     "harmonics": [(1, 1.0), (2, 0.14)]},
    {"freq": 293.66, "start": 0.26, "duration": 1.70, "attack": 0.050, "decay": 4.2,
     "release": 0.15, "gain": 0.06, "detune": 0.0010,
     "harmonics": [(1, 1.0), (2, 0.10)]},
]))

write(SOUND_DIR / "ember.wav", render_voices(2.5, [
    {"freq": 130.81, "start": 0.00, "duration": 2.50, "attack": 0.030, "decay": 2.4,
     "release": 0.25, "gain": 0.30, "detune": 0.0020,
     "harmonics": [(1, 1.0), (2, 0.20), (3, 0.05), (0.5, 0.24)]},
    {"freq": 196.00, "start": 0.16, "duration": 2.20, "attack": 0.050, "decay": 2.8,
     "release": 0.20, "gain": 0.15, "detune": 0.0014,
     "harmonics": [(1, 1.0), (2, 0.12)]},
    {"freq": 261.63, "start": 0.30, "duration": 1.80, "attack": 0.070, "decay": 3.8,
     "release": 0.15, "gain": 0.05, "detune": 0.0010,
     "harmonics": [(1, 1.0), (2, 0.08)]},
]))

write(SOUND_DIR / "resolve.wav", render_voices(2.2, [
    {"freq": 110.00, "start": 0.00, "duration": 2.20, "attack": 0.020, "decay": 2.8,
     "release": 0.20, "gain": 0.20, "detune": 0.0015,
     "harmonics": [(1, 1.0), (2, 0.25), (3, 0.07), (0.5, 0.12)]},
    {"freq": 164.81, "start": 0.18, "duration": 1.95, "attack": 0.030, "decay": 3.2,
     "release": 0.18, "gain": 0.15, "detune": 0.0012,
     "harmonics": [(1, 1.0), (2, 0.15)]},
    {"freq": 220.00, "start": 0.36, "duration": 1.70, "attack": 0.040, "decay": 3.6,
     "release": 0.16, "gain": 0.10, "detune": 0.0010,
     "harmonics": [(1, 1.0), (2, 0.10)]},
]))
