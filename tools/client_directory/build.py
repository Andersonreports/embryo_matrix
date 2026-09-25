"""Rebuild app/static/clients.js from the master client list.

    python tools/client_directory/build.py ["client name.xlsx"]

Each sheet in the workbook is one month; each cell reads
"<code> <CLIENT NAME>  <SALES REP> [emp id] [phone]". Client codes are grouped
into brands by RULES below; sheet spellings that can't be derived from the
master names go in aliases.py.
"""
import json, re, sys
from pathlib import Path
import openpyxl

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
XLSX = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'client name.xlsx'

def read_master(path):
    seen = {}
    for ws in openpyxl.load_workbook(path, read_only=True, data_only=True):
        for (v,) in ws.iter_rows(values_only=True):
            if not v or v == 'Client_Name':
                continue
            s = str(v).replace('�', "'").replace('’', "'").replace('–', '-').strip()
            # Client name and rep are separated by two spaces (or " MBBS " on a few rows).
            m = re.match(r'(\d+)\s+(.*)(?:\s{2,}| MBBS )(\S.*)$', s) or re.match(r'(\d+)\s+(.*)()$', s)
            if not m:
                continue
            code, name, rest = m.group(1), re.sub(r'\s+', ' ', m.group(2)).strip(), m.group(3)
            seen.setdefault(code, {'code': code, 'name': name, 'rep': re.sub(r'[\s\d]+$', '', rest).strip()})
    return list(seen.values())

master = read_master(XLSX)

# Ordered (pattern on master name, brand). First match wins. Anything unmatched
# falls back to the cleaned name with location / legal suffix removed.
RULES = [
    (r'\((MOTHERHOOD|MH)\)', 'Motherhood Hospital'),
    (r'^(RHEA|REHA)\b|^NOVA IVF', 'Nova IVF Fertility'),
    (r'^OASIS GENOME', 'Oasis Genome Fertility'),
    (r'^OASIS|SADGURU HEALTHCARE', 'Oasis Fertility'),
    (r'^A4 ', 'A4 Fertility Centre'),
    (r'^APOLLO FERTILITY', 'Apollo Fertility'),
    (r'^APOLLO WOMEN', "Apollo Women's Hospital"),
    (r'^APOLLO SPECIALTY', 'Apollo Specialty Hospitals'),
    (r'^APOLLOSAGE', 'ApolloSage Hospital'),
    (r'^ARC ', 'ARC Fertility'),
    (r'^BIRTH ?RIGHT|^RAINBOW CHILDRENS', 'BirthRight Fertility by Rainbow'),
    (r'^GARBHAGUDI', 'GarbhaGudi IVF Centre'),
    (r'^KIDS CLINIC INDIA', 'Cloudnine (Kids Clinic India)'),
    (r'^MOTHERHOOD', 'Motherhood Hospital'),
    (r'^MILANN', 'Milann Fertility Centre'),
    (r'^PROGENESIS', 'Progenesis Fertility Centre'),
    (r'^STAR FERTILITY', 'Star Fertility'),
    (r'^FERTY 9', 'Ferty9 Fertility Centre'),
    (r'^SUDHA FERTILITY', 'Sudha Fertility Centre'),
    (r'^SAHYADRI', 'Sahyadri Hospitals'),
    (r'^THE HIVE', 'The Hive Fertility'),
    (r'^DR\.ARAVIND', "Dr. Aravind's IVF"),
    (r'IVF ACCESS', 'IVF Access'),
    (r'^MAA KAUVERY', 'Maa Kauvery'),
    (r'^LAKSHMI MAD', 'Lakshmi Madhavan Hospital'),
    (r'^PRASHANTH FERTILITY', 'Prashanth Fertility'),
    (r'^FEMCARE', 'Femcare Fertility'),
    (r'^ANKURA', 'Ankura Hospital'),
    (r'^9M FERTILITY', '9M Fertility'),
    (r'^SHANTHI GYNEC', 'Shanthi Shell Fertility Centre'),
    (r'^SHREE FERTILITY & HEALTHCARE', 'Shree IVF Clinic'),
    (r'^HEGDE', 'Hegde Hospital'),
    (r'^AKANKSHA CENTER', 'Aspire Fertility (Akanksha)'),
    (r'^SHEMBEKAR', 'Omega Hospital (Shembekar)'),
    (r'CREATE IVF', 'Create IVF'),
    (r'^AKRUTI', 'Akruti IVF Centre'),
    (r'CHINMAY PATAKI', "Dr. Chinmay Pataki's Women Hospital"),
    (r'DHARMADHIKARI', "Dr. Dharmadhikari's Silver Lining IVF"),
    (r'^LATA MANGESHKAR', 'Deenanath Mangeshkar Hospital'),
    (r'^KASTURBA', 'Kasturba Hospital, Manipal'),
    (r'^SALEM POLYCLINIC', 'Salem Polyclinic'),
    (r'^SUNSHINE IVF', 'Sunshine IVF Centre'),
    (r'^SURYA IVF', 'Surya IVF Clinic'),
    (r'^SUNANDA', 'Sunanda IVF'),
    (r'^VRIKSH', 'Vriksh Fertility'),
    (r'^YAAMI', 'Yaami Fertility & IVF Centre'),
    (r'^ZIVAH', 'Zivah Fertility'),
    (r'^ZEEVA', 'Zeeva Healthcare'),
    (r'^UMARJI', 'Umarji Hospital'),
    (r'^SRISTI', 'Srishti Fertility'),
    (r'^JEHANGIR', 'Jehangir Hospital'),
    (r'^VARAM IVF', 'Varam IVF (MGM Healthcare)'),
    (r'^RADHAKRISHNA', 'Radhakrishna Multispeciality Hospital'),
    (r'^MAMATA', 'Mamata Fertility'),
    (r'^THE ORGIN INTERNATIONAL', 'Origin International Fertility Centre'),
    (r'^ORIGINS HOSPITAL', 'Origins Hospital'),
    (r'^BOON IVF', 'Boon IVF Fertility Centre'),
    (r'^LOTUS IVF', 'Lotus IVF Fertility (Ponnaiah Hospital)'),
    (r'^KALPA VIRUSHA', 'Kalpa Virusha Hospital'),
    (r'^SHOBHA', 'Shobha Nursing Home'),
    (r'^SHANTHI', 'Shanthi Gynec'),
    (r'^DR\. SUNITHA ILINANI', 'Jananii Fertility (Dr. Sunitha Ilinani)'),
    (r'^JANANI FERTILITY', 'Janani Fertility Centre'),
    (r'^KIMS FERTILITY', 'KIMS Fertility IVF Centre'),
    (r'^SRI CHAKRA FERTILITY', 'Sri Chakra Fertility'),
    (r'^CONTINENTAL', 'Continental Fertility Centre'),
    (r'^DR\.HUMAYUN', "Dr. Humayun's Speciality Hospital"),
    (r'^OVAL FERTILITY', 'Oval Fertility'),
    (r'^PLAN B', 'Plan B Fertility'),
    (r'^SANTASA', 'Santasa Fertility & IVF'),
    (r'^FERTILIS', 'Fertilis Withania'),
    (r'^AKSIGEN MORPHEUS', 'Aakriti Morpheus IVF (Aksigen)'),
    (r'^AKSIGEN IVF', 'Aksigen IVF'),
    (r'^MAKHIJA', 'Makhija Test Tube Baby Centre'),
    (r'^ODIGYN', 'Odigyn Fertility Care'),
    (r'^OJAS', 'Ojas Hospital'),
    (r'^ACME', 'Acme Fertility'),
    (r'^INCEPTION', 'Inception Superspeciality Women Hospital'),
    (r'^VIVEKANANDA', 'Vivekananda Polyclinic, Lucknow'),
    (r'^ALTIUS', 'Altius Hospital'),
    (r'^ABRAHAMS', 'Abrahams Infertility Centre'),
    (r'^PEARL SINGAPORE', 'Pearl Singapore Fertility Centre'),
    (r'^CREATOR', "Creator's IVF Nepal"),
    (r'^REPROART', 'ReproArt Fertility'),
    (r'^NATIONAL CENTRE FOR REPRODUCTIVE', 'National Centre for Reproductive Health'),
    (r'^SAMVED', 'Samved IVF'),
    (r'^AASHAKIRAN', 'Aashakiran IVF'),
    (r'^SABINE', 'Sabine Hospital'),
    (r'^BORNEO', 'Borneo Mother & Child Care'),
    (r'^DR B LAL', 'Dr B Lal Lab'),
    (r'^PRATIKSHA', 'Pratiksha Women & Child Care Hospital'),
    (r'^PRAVI', 'Pravi IVF'),
    (r'^ARBOR VITAL', 'Arbor Vitae Health Initiatives'),
]

# Words kept upper-case when title-casing a fallback name.
KEEP_UPPER = {'IVF', 'ART', 'PN', 'GBR', 'ADSL', 'MGM', 'KIMS', 'JK', 'LLP', 'KPHB', 'RR', 'HSR', 'HRBR', 'KKT', 'BLR', 'MRC', 'SB', 'MH', 'IIRC', 'SSPCT', 'NCR', 'A4', '9M', 'GEM'}
LOWER = {'AND', 'OF', 'THE', 'BY', 'FOR', 'IN'}

def title(s):
    out = []
    for i, w in enumerate(s.split()):
        core = re.sub(r'[^A-Z0-9]', '', w.upper())
        if core in KEEP_UPPER: out.append(w.upper())
        elif i and core in LOWER: out.append(w.lower())
        else: out.append(re.sub(r"(?<!')[A-Za-z]+", lambda m: m.group(0).capitalize(), w.lower()))
    return ' '.join(out).replace(' S ', "'s ")

BRANCH_OVERRIDES = {'17910': 'Basavanagudi', '17918': 'Electronic City', '17916': 'Kalyan Nagar', '17915': 'Hanumantha Nagar',
    '122782': 'Trichy', '163610': 'Hyderabad', '153080': 'Bangalore', '44272': 'Brookefield', '41039': 'Koramangala',
    '77141': 'Kathmandu', '149844': 'Ludhiana', '10184': 'Chennai', '124523': 'Vellore', '83620': 'MRC Nagar', '105653': 'Pondicherry',
    '103426': 'Namakkal', '139737': 'Rehari', '121806': 'Vadapalani', '151866': 'Odisha', '132357': 'Hanamkonda', '94465': 'Chembur',
    '155154': 'Haldwani', '142286': 'Kalaburagi', '165654': 'Agra', '11610': 'Madhapur', '111988': 'Bangalore', '44649': 'RR Nagar',
    '16638': 'Mysore', '168657': 'Lucknow', '46519': 'Indore', '47360': 'East Mumbai', '53958': 'Secunderabad', '146762': 'Dehradun'}

def split_name(name):
    """Return (brand part, location) from 'BRAND - LOCATION (NOVA IVF)' style names."""
    n = re.sub(r'\((NOVA IVF|MOTHERHOOD|MH)\)', '', name)
    n = re.sub(r'\(\s*A\s*UNIT[^)]*\)?', '', n, flags=re.I).strip(' )')
    m = re.match(r'^(.*\S)\s*-\s*([^-]+?)\s*$', n)
    if m and not re.search(r'(LTD|LIMITED|LLP)', m.group(2)):
        return m.group(1), m.group(2).strip(' ()')
    return n, ''
def fallback_brand(name):
    base, _ = split_name(name)
    base = re.sub(r'\s*\(\s*A\s*UNIT.*$', '', base, flags=re.I)
    base = re.sub(r'[\s,-]*\b(PVT\.?\s*LTD\.?|PVT|PRIVATE LIMITED|PRIVATE LTD|\(P\) LTD|LLP|LTD)\b.*$', '', base, flags=re.I)
    base = re.sub(r'\s*-\s*$', '', base).strip(' -,')
    return title(base)

rows = []
for m in master:
    name = m['name']
    brand = next((b for p, b in RULES if re.search(p, name)), None) or fallback_brand(name)
    _, loc = split_name(name)
    loc = BRANCH_OVERRIDES.get(m['code'], loc)
    rows.append({'code': m['code'], 'name': name, 'brand': brand, 'branch': title(loc) if loc else '', 'rep': title(m['rep'])})

from aliases import ALIASES, NOT_LISTED

def emit():
    tpl = open(HERE / 'clients_template.js', encoding='utf-8').read()
    data = json.dumps([{k: r[k] for k in ('code', 'name', 'brand', 'branch', 'rep')} for r in rows], ensure_ascii=False, separators=(',', ':'))
    data = data.replace('},{', '},\n{')
    al = ',\n'.join(json.dumps(a, ensure_ascii=False) for a in ALIASES)
    out = (tpl.replace('/*BRANCHES*/[]', data)
              .replace('/*ALIASES*/[]', '[\n' + al + '\n]')
              .replace('/*NOT_LISTED*/[]', json.dumps(NOT_LISTED)))
    open(ROOT / 'app' / 'static' / 'clients.js', 'w', encoding='utf-8', newline='\n').write(out)

emit()
print(f"{len(rows)} client codes in {len({r['brand'] for r in rows})} clients -> app/static/clients.js")
