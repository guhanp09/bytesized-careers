"""Deciding whether two stated locations are the same place.

A real import produced this: the page's structured data said "Bangalore,
Karnataka, IN" and its visible text said "Office Location: Brookefield,
Bengaluru". Those are one office described twice — a renamed city and a
neighbourhood inside it — and the recruiter was asked to arbitrate between them
as though the post had contradicted itself.

The rules here are deliberately narrow and all of them are explicit. Two places
are only called equivalent when a *listed* alias or a *listed* locality says so.
There is no fuzzy string matching, no distance heuristic, and no network call —
sending a private job post to a geocoding service to answer this would be a bad
trade even if it worked.

What this produces is a recommendation, not a decision. A location is
consequential enough that the recruiter confirms it; the value of this module is
that confirming should be one click on a sensible answer rather than typing an
address into an empty box.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Final, Literal

import geonamescache

#: How two stated locations relate. Internal vocabulary — never shown to anyone.
LocationRelation = Literal[
    "exact_equivalent",
    "normalized_equivalent",
    "alias_equivalent",
    "same_city_different_specificity",
    "probable_containment",
    "genuinely_conflicting",
    "insufficient_information",
]

#: Country codes expanded to the names a candidate would recognise.
_COUNTRIES: Final[dict[str, str]] = {
    "IN": "India",
    "IND": "India",
    "US": "United States",
    "USA": "United States",
    "UK": "United Kingdom",
    "GB": "United Kingdom",
    "GBR": "United Kingdom",
    "AE": "United Arab Emirates",
    "AU": "Australia",
    "CA": "Canada",
    "DE": "Germany",
    "FR": "France",
    "SG": "Singapore",
}

_COUNTRY_NAMES: Final[frozenset[str]] = frozenset(
    {value.casefold() for value in _COUNTRIES.values()}
)

#: State and province abbreviations expanded only where unambiguous.
_REGIONS: Final[dict[str, str]] = {
    "KA": "Karnataka",
    "MH": "Maharashtra",
    "TN": "Tamil Nadu",
    "WB": "West Bengal",
    "DL": "Delhi",
    "TS": "Telangana",
    "UP": "Uttar Pradesh",
    "NY": "New York",
    "CA-US": "California",
    # Every US state, because "City, ST" is how American listings write a
    # location and the fallback below reads the *last* component as the city.
    # That is right for "Brookefield, Bengaluru" — a neighbourhood then its city
    # — and exactly wrong for "Boston, MA", which stored the city as "MA".
    # Generated matrices found this on every US city tried; classifying the
    # component by what it *is* is the module's own design, and the positional
    # fallback is only meant for components nothing recognises.
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CO": "Colorado", "CT": "Connecticut", "FL": "Florida",
    # Suffixed like Indiana and California below: bare "DE" is Germany's
    # country code, and "Berlin, DE" means the country far more often than it
    # means Delaware. Deriving the region cases from this table is what found
    # the collision — the country reading wins, Delaware stays available.
    "DE-US": "Delaware",
    "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois",
    "IN-US": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky",
    "LA": "Louisiana", "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts",
    "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri",
    "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire",
    "NJ": "New Jersey", "NM": "New Mexico", "NC": "North Carolina",
    "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon",
    "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN-US": "Tennessee", "TX": "Texas", "UT": "Utah",
    "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
    "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
    "DC": "District of Columbia",
    # Canadian job boards commonly emit ``City, Province, Canada`` or the
    # abbreviated equivalent. Without classifying the middle component, the
    # positional fallback mistakes the province for the city (for example,
    # ``Toronto, Ontario, Canada`` became ``Ontario``). These are administrative
    # names, not city aliases, so they belong in the same explicit region table.
    "AB": "Alberta",
    "BC": "British Columbia",
    "MB": "Manitoba",
    "NB": "New Brunswick",
    "NL": "Newfoundland and Labrador",
    "NS": "Nova Scotia",
    "NT": "Northwest Territories",
    "NU": "Nunavut",
    "ON": "Ontario",
    "PE": "Prince Edward Island",
    "QC": "Quebec",
    "SK": "Saskatchewan",
    "YT": "Yukon",
}

#: Regions this module recognises by name, so a component can be classified.
_REGION_NAMES: Final[frozenset[str]] = frozenset(
    {
        "karnataka",
        "maharashtra",
        "tamil nadu",
        "west bengal",
        "delhi",
        "telangana",
        "uttar pradesh",
        "kerala",
        "gujarat",
        "haryana",
        "punjab",
        "rajasthan",
        "new york",
        "california",
        "texas",
        "england",
        "scotland",
        # Named US states must be classified just like their abbreviations.
        # Otherwise ``Salt Lake City, Utah`` leaves both components
        # unclassified and the positional fallback calls the final component
        # (Utah) the city.
        *(value.casefold() for value in _REGIONS.values()),
    }
)

# Codes whose ordinary job-board spelling is genuinely overloaded. The exact
# city/code association below disambiguates only these collisions. Everything
# else continues through the explicit tables above.
_US_REGION_CODE_COLLISIONS: Final[dict[str, str]] = {
    "CA": "California",
    "DE": "Delaware",
    "IN": "Indiana",
    "TN": "Tennessee",
}

#: City names that mean the same city. Explicit, bidirectional, reviewable.
#:
#: Deliberately tiny and limited to well-established renamings. This is not a
#: gazetteer and must not become one: every entry here is a claim that two words
#: name one place, and a wrong claim silently relocates somebody's job.
CITY_ALIASES: Final[dict[str, str]] = {
    "bangalore": "Bengaluru",
    "bengaluru": "Bengaluru",
    "bombay": "Mumbai",
    "mumbai": "Mumbai",
    "madras": "Chennai",
    "chennai": "Chennai",
    "calcutta": "Kolkata",
    "kolkata": "Kolkata",
    "poona": "Pune",
    "pune": "Pune",
    "gurgaon": "Gurugram",
    "gurugram": "Gurugram",
    "trivandrum": "Thiruvananthapuram",
    "thiruvananthapuram": "Thiruvananthapuram",
    "baroda": "Vadodara",
    "vadodara": "Vadodara",
    "mysore": "Mysuru",
    "mysuru": "Mysuru",
    # Cities with no renaming, listed so a curated locality inside them can be
    # resolved to a city this module recognises.
    "hyderabad": "Hyderabad",
    "noida": "Noida",
    "ahmedabad": "Ahmedabad",
    "jaipur": "Jaipur",
}

#: The state each known city sits in, so a specific reading can be completed.
CITY_REGIONS: Final[dict[str, tuple[str, str]]] = {
    "Bengaluru": ("Karnataka", "India"),
    "Mumbai": ("Maharashtra", "India"),
    "Chennai": ("Tamil Nadu", "India"),
    "Kolkata": ("West Bengal", "India"),
    "Pune": ("Maharashtra", "India"),
    "Gurugram": ("Haryana", "India"),
    "Hyderabad": ("Telangana", "India"),
    "Thiruvananthapuram": ("Kerala", "India"),
    "Vadodara": ("Gujarat", "India"),
    "Mysuru": ("Karnataka", "India"),
    "Noida": ("Uttar Pradesh", "India"),
    "Ahmedabad": ("Gujarat", "India"),
    "Jaipur": ("Rajasthan", "India"),
}

#: Neighbourhoods known to sit inside a city. Curated, never inferred.
#:
#: Containment is the claim most likely to be wrong if guessed — plenty of
#: suburb names repeat across countries — so it is only ever asserted from this
#: list or from a source that nested the names itself.
KNOWN_LOCALITIES: Final[dict[str, str]] = {
    "brookefield": "Bengaluru",
    "whitefield": "Bengaluru",
    "koramangala": "Bengaluru",
    "indiranagar": "Bengaluru",
    "electronic city": "Bengaluru",
    "hsr layout": "Bengaluru",
    "marathahalli": "Bengaluru",
    "powai": "Mumbai",
    "andheri": "Mumbai",
    "bandra": "Mumbai",
    "hinjewadi": "Pune",
    "guindy": "Chennai",
    # Chennai job boards frequently publish the neighbourhood as
    # ``addressLocality`` while the visible title/body names Chennai. These are
    # localities, not competing cities. Keeping that distinction here lets the
    # importer derive the city without teaching a fetcher about any one site.
    "nungambakkam": "Chennai",
    "aminjikarai": "Chennai",
    "salt lake": "Kolkata",
    "gachibowli": "Hyderabad",
    "hitec city": "Hyderabad",
}


#: Administrative wrappers that are not the name of a city.
#:
#: A page stating "Coimbatore, Coimbatore district, IN" names one city twice —
#: once plainly and once inside its district. Treating the district as the
#: locality put "Coimbatore district" into a city field, which the native
#: validator rightly refused.
_DISTRICT_SUFFIX = re.compile(
    r"\b(district|dist|county|province|prefecture|metropolitan area)\b",
    re.IGNORECASE,
)

#: Words describing an arrangement rather than a place. "Remote, India" names a
#: country and a working style; it does not name a city.
_NOT_A_PLACE: Final[frozenset[str]] = frozenset(
    {
        "remote",
        "remote friendly",
        "remote-friendly",
        "remote first",
        "remote-first",
        "fully remote",
        "100% remote",
        "hybrid friendly",
        "hybrid-friendly",
        "on-site",
        "in-office",
        "distributed",
        "flexible",
        "anywhere",
        "work from home",
        "wfh",
        "hybrid",
        "onsite",
        "on site",
        "in office",
        "in person",
        "telecommute",
        "multiple locations",
        "various",
        # A building, a floor or a legal address is where a company is
        # registered, not a city a candidate searches for. Generated matrices
        # accepted every one of these as a city, and a page's footer carries
        # them on almost every job.
        "head office",
        "headquarters",
        "hq",
        "registered office",
        "corporate office",
        "branch office",
        "main office",
        "office",
    }
)

#: Wording that names *when* someone works rather than where.
#:
#: A timezone is not a place. "Asia/Kolkata" split on its slash and stored the
#: city as "Asia"; "IST" was stored verbatim. Both describe overlap hours, which
#: the product models separately.
_TIMEZONE = re.compile(
    r"^(?:"
    r"(?:UTC|GMT)\s*[+-]?\s*\d{1,2}(?::\d{2})?|"
    r"[A-Z]{2,5}T|"  # IST, PST, EST, AEDT
    r"(?:Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific)/[\w+/-]+"
    r")$",
    re.IGNORECASE,
)

_REMOTE_ARRANGEMENT = re.compile(
    r"\b(?:remote(?:ly)?|work\s+from\s+home|wfh|telecommut(?:e|ing))\b",
    re.IGNORECASE,
)

#: A legal entity, which is who is hiring rather than where the job is.
#:
#: Only the suffixes, because they are unambiguous. A bare trading name like
#: "Larkfield Studio" is genuinely indistinguishable from a place name without a
#: gazetteer this module deliberately refuses to become — the protection for
#: that case is upstream, where a location is only read from location-labelled
#: evidence rather than from any string on the page.
_LEGAL_ENTITY = re.compile(
    r"\b(?:pvt\.?|private|ltd\.?|limited|llp|llc|inc\.?|incorporated|corp\.?|"
    r"corporation|gmbh|s\.?a\.?r\.?l|b\.?v\.?|plc|co\.?)\s*$",
    re.IGNORECASE,
)

#: A street address fragment: "Building 4", "Suite 300", "Floor 2", "Unit 7".
_ADDRESS_FRAGMENT = re.compile(
    r"^(?:building|suite|floor|unit|block|tower|plot|door|room|no\.?)\s*[\w-]{0,6}$",
    re.IGNORECASE,
)


def _is_not_a_place(part: str) -> bool:
    """Whether a component describes something other than a place."""

    cleaned = part.strip()
    return (
        cleaned.casefold() in _NOT_A_PLACE
        or bool(_REMOTE_ARRANGEMENT.search(cleaned))
        or bool(_TIMEZONE.match(cleaned))
        or bool(_ADDRESS_FRAGMENT.match(cleaned))
        or bool(_LEGAL_ENTITY.search(cleaned))
    )


@dataclass(frozen=True)
class LocationParts:
    """One stated location, split into the parts we can reason about."""

    raw: str
    locality: str | None = None
    city: str | None = None
    region: str | None = None
    country: str | None = None

    def display(self) -> str:
        """The value a candidate would read, most specific part first."""

        ordered = [self.locality, self.city, self.region, self.country]
        return ", ".join(part for part in ordered if part)


@dataclass(frozen=True)
class LocationResolution:
    """What to offer the recruiter, and the private record of why."""

    relation: LocationRelation
    #: The one-click answer. None when nothing can be responsibly recommended.
    recommended: str | None = None
    #: Every source-supported value, normalised for display, recommendation first.
    alternatives: list[str] = field(default_factory=list)
    normalization_applied: list[str] = field(default_factory=list)
    alias_applied: str | None = None
    containment_rule: str | None = None
    #: True only when equivalence is strong enough that confirming is a formality.
    confident: bool = False

    def audit(self) -> dict[str, object]:
        """Bounded private diagnostics. Never shown to a candidate."""

        return {
            "relation": self.relation,
            "recommended": self.recommended,
            "alternatives": self.alternatives[:8],
            "normalization_applied": self.normalization_applied[:8],
            "alias_applied": self.alias_applied,
            "containment_rule": self.containment_rule,
            "confident": self.confident,
        }


def _clean(value: str) -> str:
    """Strip punctuation noise without changing which words are present."""

    collapsed = re.sub(r"\s+", " ", value.replace(" ", " ")).strip()
    return collapsed.strip(" ,;|-/")


@lru_cache(maxsize=128)
def _exact_city_code_meaning(city: str, code: str) -> Literal["country", "us_region"] | None:
    """Disambiguate an overloaded code from an exact offline city match.

    ``San Francisco, CA`` and ``Toronto, CA`` use the same two letters for two
    different administrative meanings. Position alone cannot settle that, and
    silently choosing either one corrupts otherwise explicit source data. The
    repository already ships an offline GeoNames city catalog; this uses exact
    names only and asks one bounded question of it: is this city explicitly
    associated with that country or that U.S. region? No fuzzy match, distance
    heuristic, or network lookup is involved.
    """

    normalized = _clean(city).casefold()
    if not normalized or code not in _US_REGION_CODE_COLLISIONS:
        return None

    country_match = False
    region_match = False
    for item in geonamescache.GeonamesCache().get_cities().values():
        names = (item.get("name"), item.get("ascii"))
        if not any(
            isinstance(name, str) and _clean(name).casefold() == normalized
            for name in names
        ):
            continue
        if item.get("countrycode") == code:
            country_match = True
        if item.get("countrycode") == "US" and item.get("admin1code") == code:
            region_match = True

    if country_match == region_match:
        return None
    return "country" if country_match else "us_region"


#: Separators a source uses when it lists several places in one string.
#: Separators between two places a source offers as alternatives.
#:
#: ``or`` is deliberately case-sensitive here, and only when it is a word
#: between two places. "OR" is Oregon: "Springfield, OR" split into
#: "Springfield" and lost the state, which the region cases found once they
#: were derived from the table rather than written by hand. A conjunction is
#: lowercase in every real listing; the state code never is.
_MULTI_PLACE = re.compile(
    r"\s*(?:;|\||/|(?<!,)\s\bor\b|\band\b)\s*",
    re.IGNORECASE,
)

#: Parenthetical asides — usually the employer, occasionally a note.
_ASIDE = re.compile(r"\([^)]*\)")


def _first_stated_place(raw: str) -> str:
    """The first real place in a string that may name several, or none.

    A listing reading "Remote (Pansophic Learning); Tysons Corner, VA" put that
    entire string — company name and second location included — into a field
    holding one city. The employer is not a place, and a city control cannot
    hold two cities, so the aside is dropped and the first stated place is the
    one used. An arrangement like "Remote" is skipped rather than treated as a
    city, so the real location behind it is still found.
    """

    without_asides = _ASIDE.sub(" ", raw or "")
    # Checked before splitting. "Asia/Kolkata" is one timezone, and the slash
    # that separates its parts is also the slash that separates two places, so
    # splitting first turned a timezone into the city "Asia".
    if _TIMEZONE.match((raw or "").strip()):
        return ""
    candidates = [part.strip(" ,;-") for part in _MULTI_PLACE.split(without_asides)]
    for candidate in candidates:
        if not candidate:
            continue
        # "Remote: Boston, MA" labels the arrangement and then names the place.
        # The label belongs to work mode, which is read separately.
        if ":" in candidate:
            label, _, rest = candidate.partition(":")
            if label.strip().casefold() in _NOT_A_PLACE and rest.strip():
                candidate = rest.strip()
        head = candidate.split(",")[0].strip().casefold()
        if head in _NOT_A_PLACE:
            continue
        return candidate
    return next((c for c in candidates if c), raw or "")


def parse_location(raw: str) -> LocationParts:
    """Split a stated location into locality, city, region and country.

    Comma-separated components are classified by what they *are* — a known
    country, a known region, a known city, a known locality — rather than by
    position, because sources order them inconsistently.
    """

    cleaned = _clean(_first_stated_place(raw))
    if not cleaned:
        return LocationParts(raw=raw)

    components = [_clean(part) for part in cleaned.split(",")]
    components = [part for part in components if part]

    locality: str | None = None
    city: str | None = None
    region: str | None = None
    country: str | None = None
    unclassified: list[str] = []

    for index, part in enumerate(components):
        folded = part.casefold()
        upper = part.upper()
        if upper in _US_REGION_CODE_COLLISIONS and index > 0 and region is None:
            meaning = _exact_city_code_meaning(components[index - 1], upper)
            if meaning == "us_region":
                region = _US_REGION_CODE_COLLISIONS[upper]
                continue
            if meaning == "country" and upper in _COUNTRIES and country is None:
                country = _COUNTRIES[upper]
                continue
        if upper in _COUNTRIES and country is None:
            country = _COUNTRIES[upper]
            continue
        if folded in _COUNTRY_NAMES and country is None:
            country = next(
                name for name in _COUNTRIES.values() if name.casefold() == folded
            )
            continue
        if upper in _REGIONS and region == _REGIONS[upper] and city is None:
            # Two components naming the same region means one of them was never
            # the region. "New York, NY" is the case: "New York" is both a city
            # and a state, so it was taken as the state and the city became
            # "NY". A source does not write a region twice — it writes a city
            # and then that city's region.
            city, region = region, _REGIONS[upper]
            continue
        if upper in _REGIONS and region is None:
            region = _REGIONS[upper]
            continue
        if folded in _REGION_NAMES and region is None:
            region = part.title() if part.islower() or part.isupper() else part
            continue
        if folded in CITY_ALIASES and city is None:
            city = CITY_ALIASES[folded]
            continue
        if folded in KNOWN_LOCALITIES and locality is None:
            locality = part.title() if part.islower() or part.isupper() else part
            continue
        unclassified.append(part)

    # A district or county wrapper is administrative, not a city name.
    administrative = [part for part in unclassified if _DISTRICT_SUFFIX.search(part)]
    unclassified = [part for part in unclassified if part not in administrative]
    if administrative and region is None:
        region = administrative[0]

    # An arrangement is not a place, however the source ordered its components.
    unclassified = [part for part in unclassified if not _is_not_a_place(part)]

    # What remains reads most specific first, which is how sources write
    # addresses: "Brookefield, Bengaluru" is a neighbourhood then its city.
    if unclassified:
        if city is None:
            city = unclassified[-1] if len(unclassified) > 1 else unclassified[0]
        remaining = [part for part in unclassified if part != city]
        if remaining and locality is None:
            locality = remaining[0]

    return LocationParts(
        raw=raw,
        locality=locality,
        city=city,
        region=region,
        country=country,
    )


def _canonical_city(parts: LocationParts) -> str | None:
    if parts.city:
        return CITY_ALIASES.get(parts.city.casefold(), parts.city)
    if parts.locality:
        return KNOWN_LOCALITIES.get(parts.locality.casefold())
    return None


def city_for_location(raw: str) -> str | None:
    """Return the city a physical-workplace control can safely store.

    ``location`` is labelled *City* in Post Job. A neighbourhood is useful
    evidence about that city, but it is not itself a valid city selection. This
    helper is deliberately narrower than :meth:`LocationParts.display`: it
    returns a known/canonical city or nothing, never an address-shaped guess.
    """

    return _canonical_city(_complete(parse_location(raw)))


def _complete(parts: LocationParts) -> LocationParts:
    """Fill region and country from the city, when the city is one we know."""

    city = _canonical_city(parts)
    if city is None:
        return parts
    region, country = CITY_REGIONS.get(city, (parts.region, parts.country))
    return LocationParts(
        raw=parts.raw,
        locality=parts.locality,
        city=city,
        region=parts.region or region,
        country=parts.country or country,
    )


def resolve_locations(
    candidates: list[str],
    *,
    work_mode: str | None = None,
) -> LocationResolution:
    """Decide what to offer when a source states more than one location.

    ``work_mode`` matters: a remote role's office address is not the job's
    location, and recommending it would quietly turn a remote job into an
    on-site one in the listing candidates read.
    """

    cleaned = [value for value in (_clean(item) for item in candidates) if value]
    unique = list(dict.fromkeys(cleaned))
    if not unique:
        return LocationResolution(relation="insufficient_information")

    # An office address does not become a remote applicant restriction simply
    # because it is the only location string available. This must precede the
    # singleton path, which otherwise confidently promoted that office to the
    # job's location.
    if work_mode == "remote":
        return LocationResolution(
            relation="insufficient_information",
            recommended=None,
            alternatives=unique,
            normalization_applied=["remote_scope_preserved"],
        )

    if len(unique) == 1:
        parts = _complete(parse_location(unique[0]))
        city = _canonical_city(parts)
        display = city or parts.display()
        return LocationResolution(
            relation="exact_equivalent",
            recommended=display or None,
            alternatives=[display] if display else [],
            confident=bool(city),
        )

    parsed = [parse_location(value) for value in unique]
    completed = [_complete(item) for item in parsed]
    cities = {_canonical_city(item) for item in completed}
    cities.discard(None)

    normalization: list[str] = []
    if any(item.country and item.country not in item.raw for item in completed):
        normalization.append("country_code_expanded")
    if any(_clean(item.raw) != item.raw for item in parsed):
        normalization.append("whitespace_and_punctuation")

    if len(cities) > 1:
        # Two different cities is a real disagreement. Nothing is recommended;
        # both readings are offered with their own evidence intact.
        return LocationResolution(
            relation="genuinely_conflicting",
            recommended=None,
            alternatives=[item.display() for item in completed],
            normalization_applied=normalization,
        )

    if not cities:
        return LocationResolution(
            relation="insufficient_information",
            alternatives=unique,
            normalization_applied=normalization,
        )

    countries = {item.country for item in completed if item.country}
    if len(countries) > 1:
        return LocationResolution(
            relation="genuinely_conflicting",
            recommended=None,
            alternatives=[item.display() for item in completed],
            normalization_applied=normalization,
        )

    city = next(iter(cities))
    assert city is not None
    # Detected on the raw wording, because parsing has already canonicalised the
    # city by the time the parts exist. Recorded so the audit trail says which
    # explicit rule made two spellings one place.
    alias_applied = None
    spellings = {
        component
        for value in unique
        for raw_component in re.split(r"[,/|]", value)
        if (component := _clean(raw_component).casefold()) in CITY_ALIASES
    }
    if len({CITY_ALIASES[name] for name in spellings}) == 1 and len(spellings) > 1:
        alias_applied = (
            f"{city}: {' / '.join(sorted(name.title() for name in spellings))} "
            "are established names for one city"
        )

    region, country = CITY_REGIONS.get(city, (None, None))
    localities = [item.locality for item in completed if item.locality]
    # Post Job's canonical value is the city. Region/country/locality remain in
    # evidence and audit metadata; putting them in the value makes the native
    # city control reject an otherwise understood import.
    city_only = city

    if localities:
        # One source named a neighbourhood inside the city the other named.
        # Only asserted from the curated list, or because the source itself
        # nested the two names in one value.
        locality = localities[0]
        containment = (
            "curated_locality"
            if locality.casefold() in KNOWN_LOCALITIES
            else "source_nested_components"
        )
        alternatives = [city_only]
        return LocationResolution(
            relation="same_city_different_specificity",
            recommended=city_only,
            alternatives=alternatives,
            normalization_applied=normalization,
            alias_applied=alias_applied,
            containment_rule=containment,
            confident=True,
        )

    relation: LocationRelation = (
        "alias_equivalent" if alias_applied else "normalized_equivalent"
    )
    alternatives = [city_only]
    return LocationResolution(
        relation=relation,
        recommended=city_only,
        alternatives=alternatives,
        normalization_applied=normalization,
        alias_applied=alias_applied,
        confident=True,
    )
