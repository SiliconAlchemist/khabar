"""Fetch headline metadata from publisher feeds for the local Read feed."""

import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from urllib.request import Request, urlopen
from xml.etree import ElementTree


SOURCES = (
    ("BBC News", "https://feeds.bbci.co.uk/news/world/rss.xml", "World", "en"),
    ("BBC Hindi", "https://feeds.bbci.co.uk/hindi/rss.xml", "World", "hi"),
    ("Oneindia Hindi", "https://hindi.oneindia.com/rss/feeds/hindi-international-fb.xml", "World", "hi"),
    ("The Guardian", "https://www.theguardian.com/world/rss", "World", "en"),
    ("Al Jazeera", "https://www.aljazeera.com/xml/rss/all.xml", "World", "en"),
    ("France 24", "https://www.france24.com/en/rss", "World", "en"),
    ("DW", "https://rss.dw.com/rdf/rss-en-top", "World", "en"),
    ("Africanews", "https://www.africanews.com/feed/rss", "Africa", "en"),
    ("CNA", "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6511", "Asia", "en"),
    ("RNZ", "https://www.rnz.co.nz/rss/pacific.xml", "Oceania", "en"),
    ("Agência Brasil", "https://agenciabrasil.ebc.com.br/en/rss/ultimasnoticias/feed.xml", "Americas", "en"),
)
MAX_BYTES = 2 * 1024 * 1024
XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"


class ExcerptParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)


def excerpt(item):
    parser = ExcerptParser()
    parser.feed(first_text(item, "description", "summary"))
    parser.close()
    return " ".join(" ".join(parser.parts).split())[:1000]


def fields(item, name):
    return [node for node in item if node.tag.rsplit("}", 1)[-1] == name]


def first_text(item, *names):
    for name in names:
        for node in fields(item, name):
            value = "".join(node.itertext()).strip()
            if value:
                return value
    return ""


def read_feed(source):
    publisher, url, topic, source_language = source
    request = Request(url, headers={"User-Agent": "Khabar/0.1 (RSS reader)"})
    with urlopen(request, timeout=10) as response:
        xml = response.read(MAX_BYTES + 1)
    if len(xml) > MAX_BYTES or re.search(br"<!\s*(DOCTYPE|ENTITY)\b", xml.replace(b"\0", b""), re.I):
        raise ValueError("RSS XML exceeds parser limits or contains declarations")
    root = ElementTree.fromstring(xml)
    channel = next(iter(fields(root, "channel")), root)
    language = channel.get(XML_LANG) or root.get(XML_LANG) or first_text(channel, "language") or source_language
    articles = []
    for item in root.iter():
        if item.tag.rsplit("}", 1)[-1] not in ("item", "entry"):
            continue
        links = fields(item, "link")
        link = next((node.get("href") or (node.text or "").strip() for node in links
                     if node.get("rel", "alternate") == "alternate"), "")
        articles.append({
            "publisher": publisher, "topic": topic, "url": link,
            "language": item.get(XML_LANG) or first_text(item, "language") or language,
            "title": first_text(item, "title"),
            "author": first_text(item, "creator", "author"),
            "publishedAt": first_text(item, "pubDate", "published", "date", "updated"),
            "excerpt": excerpt(item),
        })
        if len(articles) >= 30:
            break
    if not articles:
        raise ValueError("No RSS or Atom entries found")
    return articles


if __name__ == "__main__":
    articles = []
    with ThreadPoolExecutor(max_workers=6) as pool:
        requests = [(source[0], pool.submit(read_feed, source)) for source in SOURCES]
        for publisher, request in requests:
            try:
                articles.extend(request.result())
            except (OSError, ValueError, ElementTree.ParseError) as error:
                print(f"{publisher}: {error}", file=sys.stderr)
    print(json.dumps(articles))
