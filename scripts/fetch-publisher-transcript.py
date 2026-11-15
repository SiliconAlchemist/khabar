import json
import re
import sys
from html.parser import HTMLParser
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener


SOURCES = {
    "practical.engineering": ("/blog/", "sqs-html-content"),
    "www.pmindia.gov.in": ("/hi/news_updates/", "news-bg"),
}
VIDEO_ID = re.compile(r"^https://(?:www\.)?youtube(?:-nocookie)?\.com/embed/([A-Za-z0-9_-]{11})(?:[?/#]|$)")
MARKER = "transcript of the video embedded above"
VOID_TAGS = frozenset("area base br col embed hr img input link meta param source track wbr".split())
MAX_BYTES = 3 * 1024 * 1024


def source_host(url):
    parsed = urlparse(url)
    host = parsed.hostname
    if (
        parsed.scheme != "https"
        or host not in SOURCES
        or parsed.netloc != host
        or not parsed.path.startswith(SOURCES[host][0])
        or parsed.fragment
    ):
        raise ValueError("Unsupported publisher transcript URL.")
    return host


class SamePublisherRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if source_host(newurl) != source_host(req.full_url):
            raise ValueError("Publisher transcript redirected to a different site.")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class EmbeddedVideo(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids = set()

    def handle_starttag(self, tag, attrs):
        if tag == "iframe":
            self.add(dict(attrs).get("src"))

    def add(self, src):
        match = VIDEO_ID.match(src or "")
        if match:
            self.ids.add(match.group(1))


class TranscriptPage(HTMLParser):
    def __init__(self, host):
        super().__init__(convert_charrefs=True)
        self.host = host
        self.stack = []
        self.block = None
        self.paragraph = None
        self.paragraphs = []
        self.video = EmbeddedVideo()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = (attrs.get("class") or "").split()
        if tag not in VOID_TAGS:
            self.stack.append((tag, classes))
        if tag == "div" and SOURCES[self.host][1] in classes and self.block is None:
            self.block = len(self.stack)
        if (
            self.host == "practical.engineering"
            and self.in_element("article")
            and attrs.get("data-provider-name") == "YouTube"
        ):
            self.video.feed(attrs.get("data-html") or "")
        if self.host == "www.pmindia.gov.in" and tag == "iframe" and self.in_element("div", "content-block"):
            self.video.add(attrs.get("src"))
        if self.block is not None and tag == "p" and not self.ignored():
            self.finish_paragraph()
            self.paragraph = []
        if tag == "br" and self.paragraph is not None:
            self.paragraph.append(" ")

    def handle_endtag(self, tag):
        if tag == "p":
            self.finish_paragraph()
        match = next((index for index in range(len(self.stack) - 1, -1, -1) if self.stack[index][0] == tag), None)
        if match is None:
            return
        del self.stack[match:]
        if self.block and len(self.stack) < self.block:
            self.finish_paragraph()
            self.block = None

    def handle_data(self, data):
        if self.paragraph is not None and not self.ignored():
            self.paragraph.append(data)

    def ignored(self):
        return any(name in ("blockquote", "script", "style") for name, _ in self.stack)

    def in_element(self, tag, class_name=None):
        return any(name == tag and (class_name is None or class_name in classes) for name, classes in self.stack)

    def finish_paragraph(self):
        if self.paragraph is None:
            return
        text = " ".join("".join(self.paragraph).split())
        if text:
            self.paragraphs.append(text)
        self.paragraph = None

    def transcript(self, video_id):
        if self.video.ids != {video_id}:
            raise ValueError("Publisher page does not embed exactly the requested YouTube video.")
        paragraphs = self.paragraphs
        if self.host == "practical.engineering":
            marker = next((i for i, text in enumerate(paragraphs) if MARKER in text.lower()), None)
            if marker is None:
                raise ValueError("Publisher page does not label its text as a transcript.")
            paragraphs = paragraphs[marker + 1 :]
        if self.host == "www.pmindia.gov.in":
            paragraphs = [
                text
                for text in paragraphs
                if not re.fullmatch(r"[\s*]*(?:[A-Z]{2,}(?:[ /\t]+[A-Z]{2,})*/*)?[\s*]*", text)
            ]
        text = "\n\n".join(paragraphs)
        if len(paragraphs) < 3 or len(text) < 400:
            raise ValueError("Publisher page lacks a usable transcript.")
        return text


def fetch_transcript(video_id, url):
    host = source_host(url)
    request = Request(url, headers={"User-Agent": "Khabar/0.1 (publisher transcripts)"})
    with build_opener(SamePublisherRedirect()).open(request, timeout=12) as response:
        if response.headers.get_content_type() != "text/html":
            raise ValueError("Publisher transcript response was not an HTML page.")
        html = response.read(MAX_BYTES + 1)
        if len(html) > MAX_BYTES:
            raise ValueError("Publisher transcript page exceeded the size limit.")
        parser = TranscriptPage(host)
        parser.feed(html.decode(response.headers.get_content_charset() or "utf-8", errors="replace"))
        parser.close()
        return parser.transcript(video_id)


if __name__ == "__main__":
    try:
        print(json.dumps(fetch_transcript(*sys.argv[1:])))
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
