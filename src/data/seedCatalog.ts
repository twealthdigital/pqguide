import type {
  AppNotification,
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
    solutions: [
      {
        answer:
          "Name each underlined clause by the job it does in its sentence: noun clause, adjectival (relative) clause, or adverbial clause.",
        explanation: [
          "Find the subject and verb inside the underlined words. If both are there, it is a clause.",
          "Check whether it can stand alone. If it cannot, it is a dependent (subordinate) clause.",
          "If it takes the place of a noun, it is a noun clause: 'I know that he is late.'",
          "If it describes a noun, it is an adjectival (relative) clause: 'The book that I bought is new.'",
          "If it tells when, why, where, how or on what condition, it is an adverbial clause: 'We stayed in because it rained.'",
          "Write the clause type and its function for each of the five sentences.",
        ],
      },
      {
        answer:
          "Skimming is reading fast for the main idea. Scanning is searching for one specific detail. Intensive reading is slow, careful reading to understand everything.",
        explanation: [
          "Skimming: glance over headings, the first and last sentences of paragraphs, and keywords to get the gist. Use it to preview a chapter.",
          "Scanning: move your eyes quickly over the text looking only for a name, date, number or keyword. Use it to find a fact in a textbook.",
          "Intensive reading: read slowly, line by line, and make notes. Use it for key course material and exam revision.",
          "Skimming gives the overview, scanning finds a detail, and intensive reading builds understanding.",
        ],
      },
      {
        answer:
          "Make each verb agree with its subject, attach each modifier to the word it describes, and put matching ideas in the same grammatical form.",
        explanation: [
          "Concord: the verb must agree with the real subject. 'Each of the students have passed' becomes 'Each of the students has passed.'",
          "Dangling modifier: the doer of the action must come right after the opening phrase. 'Walking to school, the rain started' becomes 'Walking to school, I got caught in the rain.'",
          "Faulty parallelism: list items in the same form. 'She likes reading, to swim and dancing' becomes 'She likes reading, swimming and dancing.'",
          "Apply the same three checks to each of the ten sentences and rewrite them one by one.",
        ],
      },
      {
        answer:
          "A memo has a heading (TO, FROM, DATE, SUBJECT), a clear purpose, short reasons, a specific request and a polite close, all in under 250 words.",
        explanation: [
          "Heading: TO: The Dean of Student Affairs. FROM: your name and matric number. DATE: today's date. SUBJECT: Request for Extended Library Hours During Examinations.",
          "Opening: state the purpose in one sentence. 'I write to propose that the library stays open longer during examination weeks.'",
          "Reasons: students need a quiet place to revise, hostels are often noisy or without power, and short hours cause overcrowding.",
          "Request: ask for a clear change, for example opening until 12 midnight from the first day of examinations to the last.",
          "Close: thank the Dean and say you are available to discuss it. Keep the whole memo under 250 words.",
        ],
      },
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
    solutions: [
      {
        answer:
          "Formal letters use a fixed layout and a polite, impersonal tone. Informal letters are personal and relaxed.",
        explanation: [
          "Formal: written to someone in authority or someone you do not know. It has the sender's address, the date, the receiver's address, 'Dear Sir/Madam', a subject line and ends 'Yours faithfully'.",
          "Informal: written to family or friends. It has only the sender's address and date, a first-name greeting, everyday language and ends 'Yours lovingly' or 'Your friend'.",
          "For the application letter, put your address and the date at the top right, then the employer's address on the left.",
          "Write 'Dear Sir/Madam', then a capitalised subject line: APPLICATION FOR VACATION JOB.",
          "Paragraph 1: say the job you are applying for and how you heard of it. Paragraph 2: give your course, level and relevant skills. Paragraph 3: say you are available for an interview.",
          "End with 'Yours faithfully' and your full name.",
        ],
      },
      {
        answer:
          "Summary writing is reducing a passage to its main points, in your own words and in far fewer words, without changing the meaning.",
        explanation: [
          "Read the passage twice and find the main idea of each paragraph.",
          "Underline the key points and leave out examples, illustrations, repetition and decoration.",
          "Rewrite the points in your own words. Do not copy whole sentences from the passage.",
          "Join the points in order with connectors such as 'also', 'because' and 'however'.",
          "Count your words and stay within the limit given in the question.",
        ],
      },
      {
        answer:
          "Correct each sentence by fixing the specific error: agreement, tense, spelling, punctuation or word choice.",
        explanation: [
          "Agreement: 'The news are bad' becomes 'The news is bad'.",
          "Tense: 'He go to school yesterday' becomes 'He went to school yesterday'.",
          "Wrong word: 'She gave me an advice' becomes 'She gave me some advice' because 'advice' is uncountable.",
          "Punctuation: 'Its a lovely day' becomes 'It's a lovely day'.",
          "Read each of the ten sentences slowly, name the error, then write the corrected sentence in full.",
        ],
      },
      {
        answer:
          "Use a short essay plan: introduction, effects (good then bad), and a conclusion with advice, in no more than 300 words.",
        explanation: [
          "Introduction (about 40 words): define social media and say that students use it daily.",
          "Positive effects (about 90 words): quick access to study material, online study groups, and free video lessons.",
          "Negative effects (about 110 words): constant distraction, less time for reading, and lost sleep from late-night scrolling.",
          "Conclusion (about 40 words): say that social media helps only when it is used with discipline, and advise setting daily time limits.",
          "Give the essay a title and use a new paragraph for each part.",
        ],
      },
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
    solutions: [
      {
        answer:
          "The main sections are the circulation desk, reference section, serials section, reserve (textbook) section, reading area, special collections and the ICT/e-library.",
        explanation: [
          "Circulation desk: where books are borrowed, returned and renewed.",
          "Reference section: dictionaries, encyclopaedias, atlases and handbooks. These are used in the library and not borrowed.",
          "Serials section: journals, magazines and newspapers that come out regularly.",
          "Reserve section: high-demand textbooks lent for a short time only.",
          "Special collections: theses, dissertations, archives and rare materials.",
          "ICT/e-library: computers for online databases, e-books and e-journals.",
        ],
      },
      {
        answer:
          "The Dewey Decimal Classification sorts all knowledge into ten main classes, numbered 000 to 999, and uses decimals to show narrower topics.",
        explanation: [
          "000 General works. 100 Philosophy and psychology. 200 Religion. 300 Social sciences. 400 Language.",
          "500 Natural sciences and mathematics. 600 Technology. 700 Arts and recreation. 800 Literature. 900 History and geography.",
          "Each class splits into ten divisions, and each division into ten sections. A decimal point then adds more detail, for example 510 is mathematics and 516 is geometry.",
          "Advantages: books on the same subject sit together, a book is easy to find from its number, and new topics can be added without changing the system.",
          "It is used in many libraries around the world, so a student who learns it can use any of them.",
        ],
      },
      {
        answer:
          "Five good study habits: making a timetable, studying actively, revising regularly, practising past questions and sleeping enough.",
        explanation: [
          "Timetable: planning your week means every course gets time and nothing is left to the last day.",
          "Active study: asking yourself questions and writing short notes helps you remember more than rereading.",
          "Regular revision: going over notes a little each day is better than one long night before the exam.",
          "Past questions: they show the exam style and the topics that come up often.",
          "Enough sleep: a rested mind concentrates better and recalls facts more easily in the exam hall.",
        ],
      },
      {
        answer:
          "Operating system: software that runs the computer. Browser: a program for viewing websites. Search engine: a website that finds web pages by keyword. Cloud storage: online space for keeping files.",
        explanation: [
          "Operating system: manages the hardware and lets other programs run. Examples: Windows, Android, iOS.",
          "Browser: an application used to open and view web pages. Examples: Chrome, Firefox, Safari.",
          "Search engine: a website that searches the internet for the words you type. Examples: Google, Bing.",
          "Cloud storage: a service that keeps your files on remote servers so you can open them from any device with internet. Examples: Google Drive, Dropbox.",
        ],
      },
    ],
  },
];

export const SEED_NOTIFICATIONS: AppNotification[] = [
  {
    id: 'notif-1',
    title: 'GNS 102 and GNS 103 were uploaded',
    message: 'AAUA uploaded 2024/2025 First Semester.',
    category: 'upload',
    createdAt: '2026-11-22T16:35:00.000Z',
    isRead: false,
    targetDocId: 'pq-aaua-gns103-2425',
  },
  {
    id: 'notif-2',
    title: 'AAUA past questions are live',
    message: 'Search by course code, session or semester.',
    category: 'system',
    createdAt: '2026-11-21T08:00:00.000Z',
    isRead: false,
  },
  {
    id: 'notif-3',
    title: 'Materials are here',
    message: 'Reading guides for GNS 101, GNS 102 and GNS 103 are in the Materials tab.',
    category: 'system',
    createdAt: '2026-11-25T09:00:00.000Z',
    isRead: false,
  },
];
