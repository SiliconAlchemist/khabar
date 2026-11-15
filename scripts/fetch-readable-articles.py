"""Prepare full-text manifests for releases and stories approved for republication."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
from urllib.parse import parse_qs, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener


HOSTS = {"www.pib.gov.in", "pib.gov.in"}
GLOBAL_VOICES_HOSTS = {"globalvoices.org", "hi.globalvoices.org"}
GLOBAL_VOICES_LICENSE = "https://creativecommons.org/licenses/by/3.0/"
PIB_POLICY = "https://www.pib.gov.in/ContentPage.aspx?lang=1&menuid=630&reg=21"
TIMEZONE = timezone(timedelta(hours=5, minutes=30))
LANGUAGE_CODES = {"en": 1, "hi": 2}
MAX_BYTES = 2 * 1024 * 1024
DEFAULT_RELEASES = (
    "en:2336665",  # National Zoological Park citizen science bird walk
    "en:2336519",  # India and the International Centre for Theoretical Physics
    "en:2336431",  # NIELIT digital forensics conference
    "en:2336492",  # IFFI country of honour Spain
    "hi:2336638",  # WAVES Film Bazaar
    "hi:2336483",  # NITI Aayog workshop series
    "hi:2336482",  # Army Chief's Czech Republic visit
    "hi:2336455",  # Parliamentary tribute on Janjatiya Gaurav Diwas
)
GLOBAL_VOICES_STORIES = (
    ("https://globalvoices.org/2026/11/14/learning-under-trees-in-the-era-of-ai-the-paradox-of-education-in-mozambique/", "Opinion"),
    ("https://globalvoices.org/2026/11/13/while-russia-tries-to-manipulate-information-local-civil-society-is-teaching-armenians-media-literacy/", "World"),
    ("https://globalvoices.org/2026/11/12/can-regenerative-school-gardens-strengthen-food-security-in-cameroon/", "World"),
    ("https://globalvoices.org/2026/11/10/in-ukraine-youth-are-finding-their-voices-in-the-digital-democracy/", "World"),
)
PIB_ISSUERS = {
    "en": {"Ministry of Environment, Forest and Climate Change", "Ministry of Education",
           "Ministry of Science & Technology", "Ministry of Electronics & IT"},
    "hi": {"पर्यावरण, वन एवं जलवायु परिवर्तन मंत्रालय", "शिक्षा मंत्रालय",
           "विज्ञान एवं प्रौद्योगिकी मंत्रालय", "इलेक्ट्रॉनिक्स एवं आईटी मंत्रालय"},
}


class PublisherRedirect(HTTPRedirectHandler):
    def __init__(self, hosts):
        self.hosts = hosts

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        url = urlparse(newurl)
        if url.scheme != "https" or url.hostname not in self.hosts or url.username or url.password:
            raise ValueError("Unexpected publisher redirect")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def publisher_page(url, hosts):
    request = Request(url, headers={"User-Agent": "Khabar/0.1 (licensed news reader)"})
    with build_opener(PublisherRedirect(hosts)).open(request, timeout=15) as response:
        body = response.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise ValueError("Publisher page exceeds size limit")
    return body.decode("utf-8-sig")


class ReleaseFields(HTMLParser):
    names = {"hydpermid", "ltrTitlee", "ltrSubtitlee", "ltrDescriptionn"}

    def __init__(self):
        super().__init__()
        self.fields = {}

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        field = attrs.get("id")
        if tag == "input" and field in self.names:
            self.fields[field] = attrs.get("value") or ""


class ReleaseText(HTMLParser):
    blocks = {"p", "div", "li", "h1", "h2", "h3", "h4", "section"}
    third_party = {"blockquote", "iframe", "script", "embed", "object", "table"}

    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in self.third_party:
            raise ValueError("Release contains embedded, quoted, or tabular material; review it before importing")
        if tag in self.blocks:
            self.parts.append("\n\n")
        elif tag == "br":
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self.blocks:
            self.parts.append("\n\n")

    def handle_data(self, data):
        self.parts.append(re.sub(r"[ \t\r\n\u00a0]+", " ", data))

    def paragraphs(self):
        return [line.strip() for line in re.split(r"\n+", "".join(self.parts)) if line.strip()]


def paragraphs(fragment):
    reader = ReleaseText()
    reader.feed(fragment)
    reader.close()
    return reader.paragraphs()


class ReleaseListing(HTMLParser):
    def __init__(self, language):
        super().__init__()
        self.language = language
        self.in_listing = False
        self.issuer = None
        self.collect_issuer = False
        self.releases = set()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "ul" and "num" in attrs.get("class", "").split():
            self.in_listing = True
        if not self.in_listing:
            return
        if tag == "h3":
            self.issuer = ""
            self.collect_issuer = True
        if tag == "a" and self.issuer in PIB_ISSUERS[self.language]:
            link = urlparse(attrs.get("href", ""))
            ids = parse_qs(link.query).get("PRID", [])
            if (link.path == "/PressReleseDetailm.aspx" and len(ids) == 1
                    and re.fullmatch(r"[0-9]{5,10}", ids[0])):
                self.releases.add(f"{self.language}:{ids[0]}")

    def handle_endtag(self, tag):
        if tag == "h3" and self.collect_issuer:
            self.collect_issuer = False
            self.issuer = " ".join(self.issuer.split())
        if tag == "ul":
            self.in_listing = False

    def handle_data(self, data):
        if self.collect_issuer:
            self.issuer += data


def latest_pib(language, limit):
    parser = ReleaseListing(language)
    url = f"https://www.pib.gov.in/AllReleasem.aspx?lang={LANGUAGE_CODES[language]}&reg=3"
    parser.feed(publisher_page(url, HOSTS))
    parser.close()
    return sorted(parser.releases, key=lambda spec: int(spec.split(":")[1]), reverse=True)[:limit]


def fetch_release(spec):
    language, release_id = spec.split(":")
    # Release IDs are chosen from first-party government announcements.
    url = (
        f"https://www.pib.gov.in/PressReleasePage.aspx"
        f"?PRID={release_id}&lang={LANGUAGE_CODES[language]}&reg=3"
    )
    html = publisher_page(url, HOSTS)
    parser = ReleaseFields()
    parser.feed(html)
    parser.close()
    if parser.fields.get("hydpermid") != release_id:
        raise ValueError("Page did not contain the requested PIB release")

    title = " ".join(paragraphs(parser.fields.get("ltrTitlee", "")))
    article = paragraphs(parser.fields.get("ltrDescriptionn", ""))
    subtitles = paragraphs(parser.fields.get("ltrSubtitlee", ""))
    date = re.search(r"(\d{1,2} [A-Z]{3} \d{4} \d{1,2}:\d{2}\s?[AP]M)\s+by PIB", html, re.I)
    if not title or not article or not date:
        raise ValueError("Release did not contain title, date, and full text")
    if (language == "hi") != bool(re.search(r"[\u0900-\u097f]", title)):
        raise ValueError("Release title does not match the requested language")
    date_text = re.sub(r"\s+([AP]M)$", r"\1", date[1], flags=re.I)
    published_at = datetime.strptime(date_text, "%d %b %Y %I:%M%p").replace(tzinfo=TIMEZONE)

    return {
        "url": url,
        "title": title,
        "publisher": "Press Information Bureau",
        "topic": "Government releases",
        "language": language,
        "publishedAt": published_at.isoformat(),
        "summary": article[0][:320],
        "textScope": "full",
        "attribution": "Press Information Bureau, Government of India",
        "licenseName": "PIB copyright policy",
        "licenseUrl": PIB_POLICY,
    }, "\n\n".join(subtitles + article)


class GlobalVoicesFields(ReleaseText):
    def __init__(self):
        super().__init__()
        self.meta = {}
        self.body = 0
        self.footer = 0
        self.skip_tag = ""
        self.skip_depth = 0
        self.licenses = set()
        self.byline = []
        self.credit = None

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        classes = attributes.get("class", "").split()
        if tag == "meta":
            key = attributes.get("property") or attributes.get("name")
            self.meta[key] = attributes.get("content") or ""
        if tag == "div":
            if self.footer:
                self.footer += 1
            elif "postfooter-credits" in classes:
                self.footer = 1
            if self.body:
                self.body += 1
            elif "entry" in classes:
                self.body = 1
                return
        if tag == "a" and self.footer:
            if attributes.get("rel") == "license":
                self.licenses.add(attributes.get("href"))
            if "user-link" in classes and attributes.get("aria-hidden") != "true":
                self.credit = []
        if not self.body:
            return
        if self.skip_depth:
            if tag == self.skip_tag:
                self.skip_depth += 1
            return
        if "wp-caption" in classes or tag == "figure":
            self.skip_tag = tag
            self.skip_depth = 1
            return
        super().handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        if tag == "a" and self.credit is not None:
            credit = " ".join("".join(self.credit).split())
            if credit and credit not in self.byline:
                self.byline.append(credit)
            self.credit = None
        if tag == "div" and self.footer:
            self.footer -= 1
        if tag == "div" and self.body:
            self.body -= 1
        if self.skip_depth:
            if tag == self.skip_tag:
                self.skip_depth -= 1
            return
        if self.body:
            super().handle_endtag(tag)

    def handle_data(self, data):
        if self.credit is not None:
            self.credit.append(data)
        if self.body and not self.skip_depth:
            super().handle_data(data)


def fetch_global_voices(story):
    url, topic = story
    parser = GlobalVoicesFields()
    parser.feed(publisher_page(url, GLOBAL_VOICES_HOSTS))
    parser.close()
    title, source_url, article_date = (parser.meta.get(key) for key in (
        "og:title", "og:url", "article:published_time"
    ))
    content = parser.paragraphs()
    if parser.licenses != {GLOBAL_VOICES_LICENSE}:
        raise ValueError("Missing or different article-level Creative Commons license")
    if not title or source_url != url or not content or not parser.byline or not article_date:
        raise ValueError("Could not verify the article and its credits")
    language = "hi" if urlparse(url).hostname == "hi.globalvoices.org" else "en"
    author = ", ".join(parser.byline)
    return {
        "url": url,
        "title": title,
        "publisher": "Global Voices",
        "author": author,
        "topic": topic,
        "language": language,
        "publishedAt": datetime.fromisoformat(article_date).isoformat(),
        "summary": parser.meta.get("og:description", "")[:320],
        "textScope": "full",
        "attribution": f"{author} · Global Voices · Text-only edition",
        "licenseName": "CC BY 3.0",
        "licenseUrl": GLOBAL_VOICES_LICENSE,
    }, "\n\n".join(content)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True, help="Output manifest JSON path")
    parser.add_argument(
        "--release", action="append", metavar="LANGUAGE:ID",
        help="Reviewed first-party PIB release to import. Repeat for multiple releases.",
    )
    parser.add_argument("--pib-latest-per-language", type=int, metavar="COUNT",
                        help="Discover up to COUNT recent PIB releases per language from approved issuers.")
    parser.add_argument("--global-voices", action="store_true", help="Include reviewed Global Voices articles.")
    args = parser.parse_args()
    default_seed = () if args.global_voices or args.pib_latest_per_language is not None else DEFAULT_RELEASES
    releases = list(dict.fromkeys(args.release or default_seed))
    if args.pib_latest_per_language is not None and not 1 <= args.pib_latest_per_language <= 10:
        parser.error("--pib-latest-per-language must be between 1 and 10")
    if len(releases) > 30 or not all(re.fullmatch(r"(?:en|hi):[0-9]{5,10}", spec) for spec in releases):
        parser.error("Provide at most 30 PIB release IDs using en:ID or hi:ID")
    articles = []
    args.output.parent.mkdir(parents=True, exist_ok=True)
    body_dir = args.output.parent / "readable-article-text"
    body_dir.mkdir(exist_ok=True)
    with ThreadPoolExecutor(max_workers=4) as pool:
        if args.pib_latest_per_language:
            listings = [pool.submit(latest_pib, lang, args.pib_latest_per_language) for lang in LANGUAGE_CODES]
            for listing in listings:
                try:
                    releases.extend(listing.result())
                except (OSError, ValueError) as error:
                    print(f"PIB listing: {error}", file=sys.stderr)
        jobs = [(f"pib-{spec.replace(':', '-')}", pool.submit(fetch_release, spec))
                for spec in dict.fromkeys(releases)]
        if args.global_voices:
            jobs.extend((f"global-voices-{urlparse(story[0]).path.rstrip('/').rsplit('/', 1)[-1]}",
                         pool.submit(fetch_global_voices, story)) for story in GLOBAL_VOICES_STORIES)
        for name, job in jobs:
            try:
                entry, text = job.result()
            except (OSError, ValueError) as error:
                print(f"{name}: {error}", file=sys.stderr)
                continue
            file = body_dir / (name + ".txt")
            file.write_text(text, encoding="utf-8")
            entry["textFile"] = file.relative_to(args.output.parent).as_posix()
            articles.append(entry)
    if not articles:
        parser.exit(1, "No verified readable articles could be imported.\n")
    args.output.write_text(json.dumps(articles, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Prepared {len(articles)} readable articles with attribution in {args.output}.")


if __name__ == "__main__":
    main()
