"""Run PDF extraction in a short-lived child with a memory limit on Linux."""
import io
import json
import sys

MAX_BYTES = 1_048_576


def main():
    if sys.platform == "linux":
        import resource

        resource.setrlimit(resource.RLIMIT_AS, (384 * 1024**2, 384 * 1024**2))
    from pypdf import PdfReader

    data = sys.stdin.buffer.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES or not data.startswith(b"%PDF-"):
        raise ValueError("Invalid PDF")
    reader = PdfReader(io.BytesIO(data), strict=True)
    if reader.is_encrypted or not 1 <= len(reader.pages) <= 60:
        raise ValueError("Encrypted or oversized PDF")
    pages = []
    for page in reader.pages:
        content = page.get_contents()
        if content and len(content.get_data()) > 1_000_000:
            raise ValueError("Oversized PDF page stream")
        pages.append((page.extract_text() or "")[:16000])
    print(json.dumps(pages))


if __name__ == "__main__":
    main()
