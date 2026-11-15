import argparse
import os
from pathlib import Path
import sys


def timestamp(seconds):
    total_ms = round(seconds * 1000)
    seconds, milliseconds = divmod(total_ms, 1000)
    minutes, seconds = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours:02}:{minutes:02}:{seconds:02}.{milliseconds:03}"


def support_pyav_19():
    import av

    if int(av.__version__.split(".")[0]) < 19:
        return

    # faster-whisper 1.2.1 still passes a keyword PyAV 19 removed.
    open_media = av.open

    def open_compatible(*args, **kwargs):
        kwargs.pop("metadata_errors", None)
        return open_media(*args, **kwargs)

    av.open = open_compatible


def main():
    parser = argparse.ArgumentParser(description="Transcribe a local media file with Whisper.")
    parser.add_argument("media", type=Path)
    parser.add_argument("--cache-dir", required=True)
    args = parser.parse_args()
    if not args.media.is_file():
        parser.error("media must be a local audio or video file")

    device = os.environ.get("KHABAR_WHISPER_DEVICE", "cpu")
    if device not in ("cpu", "cuda"):
        parser.error("KHABAR_WHISPER_DEVICE must be cpu or cuda")

    from faster_whisper import WhisperModel
    from huggingface_hub import try_to_load_from_cache

    support_pyav_19()
    cached_model = try_to_load_from_cache(
        "mobiuslabsgmbh/faster-whisper-large-v3-turbo", "model.bin",
        cache_dir=args.cache_dir,
    )
    model = WhisperModel(
        str(Path(cached_model).parent) if isinstance(cached_model, str) else "turbo",
        device=device, compute_type="float16" if device == "cuda" else "int8",
        download_root=args.cache_dir,
    )
    segments, _ = model.transcribe(str(args.media), task="transcribe", multilingual=True, vad_filter=True)
    for segment in segments:
        text = segment.text.strip()
        if text:
            line = f"[{timestamp(segment.start)} --> {timestamp(segment.end)}] {text}\n"
            sys.stdout.buffer.write(line.encode("utf-8"))


if __name__ == "__main__":
    try:
        main()
    except ModuleNotFoundError as error:
        sys.exit(f"Missing Whisper dependency ({error.name}). See the Whisper setup in README.md.")
    except Exception as error:
        sys.exit(f"Whisper: {error}")
