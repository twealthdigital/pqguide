import type {
  AppNotification,
  ManagedAccount,
  PastQuestionDoc,
  School,
} from '../core/types';

/**
 * Isolated starter catalog.
 * Can be cleared via Super Admin ("Clear Starter Samples") or replaced
 * with a live API adapter inside src/services/archiveRepository.ts.
 */
export const SEED_SCHOOLS: School[] = [
  {
    id: 'sch-aaua',
    code: 'AAUA',
    name: 'Adekunle Ajasin University, Akungba-Akoko',
    shortName: 'AAUA Akungba',
    location: 'Ondo State, Nigeria',
    isActive: true,
    isPrimaryLaunch: true,
  },
  {
    id: 'sch-oau',
    code: 'OAU',
    name: 'Obafemi Awolowo University',
    shortName: 'OAU Ile-Ife',
    location: 'Osun State, Nigeria',
    isActive: false,
    isPrimaryLaunch: false,
  },
  {
    id: 'sch-futa',
    code: 'FUTA',
    name: 'Federal University of Technology, Akure',
    shortName: 'FUTA Akure',
    location: 'Ondo State, Nigeria',
    isActive: false,
    isPrimaryLaunch: false,
  },
];

export const SEED_SESSIONS: string[] = [
  '2024/2025',
  '2023/2024',
  '2022/2023',
  '2021/2022',
  '2020/2021',
];

export const SEED_PAST_QUESTIONS: PastQuestionDoc[] = [
  {
    id: 'pq-aaua-gns101-2324',
    schoolId: 'sch-aaua',
    schoolCode: 'AAUA',
    courseCode: 'GNS 101',
    courseTitle: 'Use of English & Communication Skills',
    department: 'General Studies',
    faculty: 'General Studies Unit',
    level: '100L',
    session: '2023/2024',
    year: 2024,
    semester: 'First Semester',
    sourceType: 'scanned_image',
    originalFileName: 'GNS101_Page1_Scan.jpg',
    isFreePreview: true,
    uploadedBy: 'AAUA GNS Secretariat',
    uploadedAt: '2026-11-19T14:40:00.000Z',
    viewsCount: 2890,
    status: 'published',
    extractedText:
      'ADEKUNLE AJASIN UNIVERSITY, AKUNGBA-AKOKO\nCENTRE FOR GENERAL STUDIES · 2023/2024 HARMATTAN EXAMINATION\nGNS 101: USE OF ENGLISH I · TIME: 1 HOUR 30 MINUTES',
    questions: [
      'Q1: Identify the grammatical function and name of the underlined clauses in each of the five sentences provided in Section A.',
      'Q2: Distinguish between skimming, scanning, and intensive reading as academic study techniques for undergraduate comprehension.',
      'Q3: Rewrite the following ten sentences correcting errors of concord, dangling modifiers, and faulty parallelism.',
      'Q4: Write a formal memorandum to the Dean of Student Affairs proposing extended library hours during examination weeks (not more than 250 words).',
    ],
  },
  {
    id: 'pq-aaua-gns102-2324',
    schoolId: 'sch-aaua',
    schoolCode: 'AAUA',
    courseCode: 'GNS 102',
    courseTitle: 'Use of English & Communication Skills II',
    department: 'General Studies',
    faculty: 'General Studies Unit',
    level: '100L',
    session: '2023/2024',
    year: 2024,
    semester: 'Second Semester',
    sourceType: 'scanned_image',
    originalFileName: 'GNS102_Rain_2023_2024_Scan.jpg',
    isFreePreview: true,
    uploadedBy: 'AAUA GNS Secretariat',
    uploadedAt: '2026-11-20T10:15:00.000Z',
    viewsCount: 1960,
    status: 'published',
    extractedText:
      'ADEKUNLE AJASIN UNIVERSITY, AKUNGBA-AKOKO\nCENTRE FOR GENERAL STUDIES · 2023/2024 RAIN SEMESTER EXAMINATION\nGNS 102: USE OF ENGLISH II · TIME: 1 HOUR 30 MINUTES',
    questions: [
      'Q1: Differentiate between formal and informal letters, and write a formal application letter for a vacation job.',
      'Q2: Explain the term "summary writing" and list four techniques for writing an effective summary.',
      'Q3: Identify and correct the errors in the ten sentences provided in Section B.',
      'Q4: Write an essay of not more than 300 words on the effects of social media on undergraduate study habits.',
    ],
  },
  {
    id: 'pq-aaua-gns103-2425',
    schoolId: 'sch-aaua',
    schoolCode: 'AAUA',
    courseCode: 'GNS 103',
    courseTitle: 'Use of Library, Study Skills & ICT',
    department: 'General Studies',
    faculty: 'General Studies Unit',
    level: '100L',
    session: '2024/2025',
    year: 2025,
    semester: 'First Semester',
    sourceType: 'scanned_image',
    originalFileName: 'GNS103_Harmattan_2425.jpg',
    isFreePreview: false,
    uploadedBy: 'AAUA GNS Secretariat',
    uploadedAt: '2026-11-21T09:30:00.000Z',
    viewsCount: 1210,
    status: 'published',
    extractedText:
      'ADEKUNLE AJASIN UNIVERSITY, AKUNGBA-AKOKO\nCENTRE FOR GENERAL STUDIES · 2024/2025 HARMATTAN EXAMINATION\nGNS 103: USE OF LIBRARY, STUDY SKILLS & ICT · TIME: 1 HOUR',
    questions: [
      'Q1: Describe the main sections of a university library and the type of material found in each.',
      'Q2: Explain the Dewey Decimal Classification system and state its advantages for locating books.',
      'Q3: List five effective study habits and explain how each improves examination performance.',
      'Q4: Define the following ICT terms: operating system, browser, search engine, and cloud storage.',
    ],
  },
];

export const SEED_NOTIFICATIONS: AppNotification[] = [
  {
    id: 'notif-1',
    title: 'New AAUA 2024/2025 Harmattan Papers Indexed',
    message:
      'GNS 102 and GNS 103 general studies papers have been scanned, indexed, and added to the searchable archive.',
    category: 'upload',
    createdAt: '2026-11-22T16:35:00.000Z',
    isRead: false,
    targetDocId: 'pq-aaua-gns103-2425',
  },
  {
    id: 'notif-2',
    title: 'AAUA Portal Live for All Departments',
    message:
      'Filter instantly by Academic Session, Semester, and Course Code. Free preview papers are marked for immediate reading.',
    category: 'system',
    createdAt: '2026-11-21T08:00:00.000Z',
    isRead: false,
  },
  {
    id: 'notif-3',
    title: 'Flexible Monthly, Semester & Session Passes',
    message:
      'Plans start at ₦500/month or ₦2,000/semester. Tiers from ₦1,000/mo and ₦3,500/semester include reserved AI study access.',
    category: 'billing',
    createdAt: '2026-11-19T12:10:00.000Z',
    isRead: true,
  },
];

export const SEED_ACCOUNTS: ManagedAccount[] = [
  {
    id: 'acc-1',
    fullName: 'Toluwanimi Adeyemi',
    email: 't.adeyemi@aaua.edu.ng',
    role: 'student',
    schoolCode: 'AAUA',
    tierId: 'semester_2000',
    status: 'active',
    lastActiveAt: '2026-11-23T09:10:00.000Z',
  },
  {
    id: 'acc-2',
    fullName: 'Dr. Femi Ogunleye (Exam Unit)',
    email: 'examoffice@aaua.edu.ng',
    role: 'school_admin',
    schoolCode: 'AAUA',
    tierId: 'session_8500',
    status: 'active',
    lastActiveAt: '2026-11-23T08:45:00.000Z',
  },
  {
    id: 'acc-3',
    fullName: 'Chisom Okafor',
    email: 'c.okafor@aaua.edu.ng',
    role: 'student',
    schoolCode: 'AAUA',
    tierId: 'free',
    status: 'active',
    lastActiveAt: '2026-11-22T19:20:00.000Z',
  },
  {
    id: 'acc-4',
    fullName: 'Adebayo Rotimi',
    email: 'a.rotimi@aaua.edu.ng',
    role: 'student',
    schoolCode: 'AAUA',
    tierId: 'monthly_1000',
    status: 'active',
    lastActiveAt: '2026-11-22T14:05:00.000Z',
  },
];
