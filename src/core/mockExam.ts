import type { PastQuestionDoc, QuestionSolution, StudyMaterial } from './types';
import { cleanCourseTitle } from './docTitle';
import { STUDY_MATERIALS } from '../data/materials';

/**
 * Practice-exam builder (local preview mode — no external AI calls).
 *
 * Supports four exam formats:
 * - obj: Full paper list of multiple-choice questions (A–D)
 * - theory: Full paper list of essay/short-answer questions with answer boxes underneath
 * - boolean: Full paper list of True / False statements
 * - cbt: Computer-Based Test (one multiple-choice question at a time with A–D options)
 */

export const ALL_COURSES = 'ALL';

export type ExamType = 'obj' | 'theory' | 'boolean' | 'cbt';

export interface ExamTypeMeta {
  id: ExamType;
  label: string;
  badge: string;
  description: string;
}

export const EXAM_TYPES: ExamTypeMeta[] = [
  {
    id: 'obj',
    label: 'OBJ (Paper)',
    badge: 'OBJ Paper',
    description: 'Full list of questions with A–D options like a real paper',
  },
  {
    id: 'theory',
    label: 'Theory (Paper)',
    badge: 'Theory Paper',
    description: 'All questions on one paper with answer spaces underneath',
  },
  {
    id: 'boolean',
    label: 'True / False',
    badge: 'True / False',
    description: 'Statements where you select True or False only',
  },
  {
    id: 'cbt',
    label: 'CBT',
    badge: 'CBT',
    description: 'Multiple-choice options shown one question at a time',
  },
];

export interface ExamCourseOption {
  code: string;
  title: string;
  level: string;
  questionCount: number;
  sessionCount: number;
}

export interface ExamSpec {
  examType: ExamType;
  /** A course code, or ALL_COURSES. */
  courseCode: string;
  questionCount: number;
  minutes: number;
  /** Optional topic words the student wants more of. */
  focus: string;
}

export interface ExamQuestion {
  id: string;
  number: number;
  text: string;
  courseCode: string;
  source: string;
  solution: QuestionSolution | null;
  /** Short reasons this question was picked, shown as tags. */
  reasons: string[];
  /** Multiple-choice options (A–D) for 'obj' and 'cbt'. */
  options?: string[];
  /** Zero-based correct option index for 'obj' and 'cbt'. */
  correctIndex?: number;
  /** Correct answer for 'boolean' (True/False). */
  correctBoolean?: boolean;
}

export interface BuiltExam {
  examType: ExamType;
  questions: ExamQuestion[];
  /** How many archive past questions were available for the chosen course. */
  poolSize: number;
}

const stripLabel = (q: string) => q.replace(/^Q\d+\s*[:.)-]\s*/i, '').trim();

const STOP = new Set([
  'about', 'above', 'after', 'again', 'also', 'answer', 'because', 'been', 'before', 'between',
  'both', 'could', 'describe', 'discuss', 'does', 'each', 'explain', 'from', 'give', 'have',
  'into', 'list', 'marks', 'more', 'most', 'must', 'much', 'only', 'other', 'question',
  'should', 'some', 'state', 'such', 'than', 'that', 'their', 'them', 'then', 'there', 'these',
  'they', 'this', 'those', 'using', 'what', 'when', 'where', 'which', 'while', 'with', 'would',
  'write', 'your',
]);

const tokens = (text: string): Set<string> => {
  const out = new Set<string>();
  for (const w of text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)) {
    if (w.length >= 4 && !STOP.has(w)) out.add(w);
  }
  return out;
};

const shared = (a: Set<string>, b: Set<string>) => {
  let n = 0;
  a.forEach((w) => {
    if (b.has(w)) n += 1;
  });
  return n;
};

/** Courses that have at least one question, for the course picker. */
export const listExamCourses = (docs: PastQuestionDoc[]): ExamCourseOption[] => {
  const map = new Map<string, ExamCourseOption & { sessions: Set<string> }>();
  for (const doc of docs) {
    const count = doc.questions.map(stripLabel).filter((q) => q.length > 7).length;
    if (count === 0) continue;
    const entry = map.get(doc.courseCode) ?? {
      code: doc.courseCode,
      title: cleanCourseTitle(doc),
      level: doc.level,
      questionCount: 0,
      sessionCount: 0,
      sessions: new Set<string>(),
    };
    entry.questionCount += count;
    entry.sessions.add(doc.session);
    entry.sessionCount = entry.sessions.size;
    if (!entry.title) entry.title = cleanCourseTitle(doc);
    map.set(doc.courseCode, entry);
  }
  return Array.from(map.values())
    .map(({ sessions: _sessions, ...rest }) => rest)
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
};

export const countQuestionsFor = (docs: PastQuestionDoc[], courseCode: string): number =>
  listExamCourses(docs)
    .filter((c) => courseCode === ALL_COURSES || c.code === courseCode)
    .reduce((sum, c) => sum + c.questionCount, 0);

// ---------------------------------------------------------------------------
// Local topic suggestions (from study guides & archive themes)
// ---------------------------------------------------------------------------

const COURSE_TOPICS: Record<string, string[]> = {
  'GNS 101': [
    'Concord & verb agreement',
    'Noun & relative clauses',
    'Skimming vs scanning',
    'Dangling modifiers',
    'Formal memorandum',
    'Tenses & uncountable nouns',
  ],
  'GNS 102': [
    'Formal & informal letters',
    'Summary writing rules',
    'Essay structure',
    'Run-on sentences',
    'Error correction',
    'Affect vs effect',
  ],
  'GNS 103': [
    'Library sections',
    'Dewey Decimal System',
    'SQ3R study method',
    'Input & output devices',
    'Operating systems & browsers',
    'Cloud storage & safety',
  ],
};

export const suggestTopicsForCourse = (
  docs: PastQuestionDoc[],
  materials: StudyMaterial[],
  courseCode: string
): string[] => {
  if (courseCode !== ALL_COURSES && COURSE_TOPICS[courseCode]) {
    return COURSE_TOPICS[courseCode];
  }

  if (courseCode === ALL_COURSES) {
    return [
      'Concord & grammar',
      'Summary & letter writing',
      'Skimming & scanning',
      'Dewey Decimal System',
      'Library sections',
      'ICT & cloud storage',
    ];
  }

  // Dynamic fallback for newly uploaded courses
  const topics: string[] = [];
  const scopedMaterials = materials.filter((m) => m.courseCode === courseCode);
  for (const m of scopedMaterials) {
    for (const s of m.sections) {
      if (!topics.includes(s.heading)) topics.push(s.heading);
    }
  }
  if (topics.length >= 4) return topics.slice(0, 6);

  const freq = new Map<string, number>();
  const scopedDocs = docs.filter((d) => d.courseCode === courseCode);
  for (const doc of scopedDocs) {
    for (const raw of doc.questions) {
      tokens(stripLabel(raw)).forEach((w) => {
        freq.set(w, (freq.get(w) ?? 0) + 1);
      });
    }
  }
  const topWords = Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([w]) => w.charAt(0).toUpperCase() + w.slice(1));

  return [...topics, ...topWords].slice(0, 6);
};

// ---------------------------------------------------------------------------
// Curated local OBJ / CBT & True/False banks aligned to course guides
// ---------------------------------------------------------------------------

interface McqSeed {
  courseCode: string;
  topic: string;
  text: string;
  options: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  explanation: string[];
}

interface BoolSeed {
  courseCode: string;
  topic: string;
  text: string;
  correctBoolean: boolean;
  explanation: string[];
}

const MCQ_BANK: McqSeed[] = [
  // GNS 101
  {
    courseCode: 'GNS 101',
    topic: 'concord grammar verb agreement',
    text: 'Choose the grammatically correct sentence:',
    options: [
      'The box of pencils are on the desk.',
      'The box of pencils is on the desk.',
      'The box of pencils were on the desk.',
      'The box of pencils have been on the desk.',
    ],
    correctIndex: 1,
    explanation: [
      'The true subject of the sentence is the singular noun "box", not "pencils".',
      'Therefore, the singular verb "is" must be used.',
    ],
  },
  {
    courseCode: 'GNS 101',
    topic: 'concord grammar neither nor',
    text: 'Neither the lecturer nor the students _____ late for the morning class.',
    options: ['was', 'is', 'were', 'has been'],
    correctIndex: 2,
    explanation: [
      'With "neither ... nor", the verb agrees with the subject nearer to it.',
      'Since "students" is plural and closer to the verb, "were" is correct.',
    ],
  },
  {
    courseCode: 'GNS 101',
    topic: 'skimming scanning reading comprehension',
    text: 'Which reading technique is best for quickly finding a specific date or name in a textbook?',
    options: ['Skimming', 'Scanning', 'Intensive reading', 'Proofreading'],
    correctIndex: 1,
    explanation: [
      'Scanning means moving your eyes rapidly through a text to locate one specific detail such as a name, date, or figure.',
      'Skimming gets the general gist, while intensive reading builds deep understanding.',
    ],
  },
  {
    courseCode: 'GNS 101',
    topic: 'clauses noun adjectival adverbial',
    text: 'In the sentence "The book that I bought is new", the underlined clause "that I bought" is an example of a(n) _____ clause.',
    options: ['Noun', 'Adverbial', 'Adjectival (relative)', 'Independent'],
    correctIndex: 2,
    explanation: [
      'The clause "that I bought" modifies the noun "book".',
      'A subordinate clause that describes or qualifies a noun is an adjectival (relative) clause.',
    ],
  },
  {
    courseCode: 'GNS 101',
    topic: 'uncountable nouns grammar tenses',
    text: 'Which of the following sentences uses uncountable nouns correctly?',
    options: [
      'She gave me some useful advice.',
      'She gave me an advice before the exam.',
      'She gave me many advices yesterday.',
      'The laboratory has new equipments.',
    ],
    correctIndex: 0,
    explanation: [
      'Uncountable nouns like "advice", "information", "furniture", and "equipment" do not take "a/an" or a plural "-s".',
      'Use quantifiers such as "some" or "a piece of" instead.',
    ],
  },
  {
    courseCode: 'GNS 101',
    topic: 'dangling modifiers parallelism grammar',
    text: 'Identify the sentence that avoids a dangling modifier:',
    options: [
      'Walking to school, the rain started heavily.',
      'Walking to school, my bag got wet in the rain.',
      'Walking to school, I was caught in the rain.',
      'Walking to school, the umbrella blew away.',
    ],
    correctIndex: 2,
    explanation: [
      'The doer of the opening action ("Walking to school") must appear immediately after the comma.',
      '"I" is the person walking, so "Walking to school, I was caught in the rain" is correct.',
    ],
  },
  {
    courseCode: 'GNS 101',
    topic: 'formal memorandum writing',
    text: 'Which four elements form the standard heading of a formal memorandum?',
    options: [
      'Dear Sir, Body, Reference, Signature',
      'TO, FROM, DATE, SUBJECT',
      'Address, Salutation, Paragraph, Yours faithfully',
      'Title, Abstract, Methodology, Conclusion',
    ],
    correctIndex: 1,
    explanation: [
      'A formal internal memorandum opens with TO, FROM, DATE, and SUBJECT.',
      'It does not use personal letter salutations like "Dear Sir/Madam" or "Yours faithfully".',
    ],
  },
  {
    courseCode: 'GNS 101',
    topic: 'parts of speech pronoun verb adverb',
    text: 'Which part of speech modifies a verb, an adjective, or another adverb?',
    options: ['Conjunction', 'Preposition', 'Adverb', 'Interjection'],
    correctIndex: 2,
    explanation: [
      'An adverb describes how, when, where, or to what extent an action occurs.',
      'Examples include "quickly", "carefully", and "very".',
    ],
  },
  {
    courseCode: 'GNS 101',
    topic: 'faulty parallelism grammar',
    text: 'Select the sentence that demonstrates correct parallelism:',
    options: [
      'She enjoys reading, to swim, and dancing.',
      'She enjoys reading, swimming, and dancing.',
      'She enjoys to read, swimming, and to dance.',
      'She enjoys read, swim, and dancing.',
    ],
    correctIndex: 1,
    explanation: [
      'Parallelism requires items in a list to share the same grammatical form.',
      'Using gerunds throughout ("reading, swimming, and dancing") keeps the list balanced.',
    ],
  },
  {
    courseCode: 'GNS 101',
    topic: 'concord collective noun singular',
    text: 'Each of the matriculated students _____ received an examination docket.',
    options: ['have', 'were', 'has', 'are'],
    correctIndex: 2,
    explanation: [
      '"Each" is always treated as singular.',
      'Even though "students" is plural, the singular verb "has" agrees with "Each".',
    ],
  },

  // GNS 102
  {
    courseCode: 'GNS 102',
    topic: 'formal letter salutation subscription',
    text: 'When a formal letter begins with "Dear Sir/Madam", what is the appropriate complimentary close?',
    options: ['Yours sincerely', 'Yours faithfully', 'Your friend', 'Best wishes'],
    correctIndex: 1,
    explanation: [
      'Use "Yours faithfully" when you address someone by title/salutation without their name ("Dear Sir/Madam").',
      'Use "Yours sincerely" only when you address the person by name (e.g., "Dear Dr. Adeyemi").',
    ],
  },
  {
    courseCode: 'GNS 102',
    topic: 'summary writing passage',
    text: 'Which of the following is NOT a good practice when writing a summary?',
    options: [
      'Finding the main idea of each paragraph',
      'Using your own words concisely',
      'Copying whole sentences verbatim with examples',
      'Staying within the stated word limit',
    ],
    correctIndex: 2,
    explanation: [
      'Good summary writing leaves out examples, repetition, and decoration.',
      'You should express the main points in your own words rather than lifting whole sentences.',
    ],
  },
  {
    courseCode: 'GNS 102',
    topic: 'affect effect common mistakes',
    text: 'Choose the sentence that uses "affect" and "effect" accurately:',
    options: [
      'Late-night scrolling can effect your grades.',
      'The new timetable had a positive affect on attendance.',
      'Noise in the hostel can affect your concentration.',
      'What is the affect of skipping revision?',
    ],
    correctIndex: 2,
    explanation: [
      '"Affect" is usually a verb meaning to influence.',
      '"Effect" is usually a noun meaning a result or outcome.',
    ],
  },
  {
    courseCode: 'GNS 102',
    topic: 'run-on sentences punctuation',
    text: 'A "run-on sentence" (comma splice) happens when:',
    options: [
      'A sentence has more than ten words.',
      'Two complete sentences are joined with only a comma.',
      'A paragraph starts with a transitional word.',
      'A formal letter omits the receiver address.',
    ],
    correctIndex: 1,
    explanation: [
      'Joining two independent clauses with just a comma creates a run-on / comma splice error.',
      'Fix it with a full stop, a semicolon, or a coordinating conjunction like "and" or "but".',
    ],
  },
  {
    courseCode: 'GNS 102',
    topic: 'its it\'s punctuation',
    text: 'Complete the sentence correctly: "_____ important for the committee to submit _____ report today."',
    options: [
      'Its / it’s',
      'It’s / its',
      'Its / its',
      'It’s / it’s',
    ],
    correctIndex: 1,
    explanation: [
      '"It’s" is the contraction of "it is".',
      '"Its" (without an apostrophe) shows ownership or possession.',
    ],
  },
  {
    courseCode: 'GNS 102',
    topic: 'essay structure writing',
    text: 'In a well-structured academic essay, what should each body paragraph contain?',
    options: [
      'Multiple unrelated arguments mixed together',
      'One main idea supported by a clear point and example',
      'Only a dictionary definition',
      'A repeat of the essay title and date',
    ],
    correctIndex: 1,
    explanation: [
      'Paragraph unity means focusing on one clear idea per paragraph.',
      'Support the topic sentence with explanations or brief examples.',
    ],
  },
  {
    courseCode: 'GNS 102',
    topic: 'formal letter layout',
    text: 'Where is the writer’s address and date normally placed in a traditional formal letter?',
    options: [
      'Bottom left corner below the signature',
      'Top right corner of the page',
      'Centred right after the subject line',
      'Inside the concluding paragraph',
    ],
    correctIndex: 1,
    explanation: [
      'In standard formal letter layout, the sender’s address and date sit at the top right.',
      'The receiver’s address follows on the left margin.',
    ],
  },
  {
    courseCode: 'GNS 102',
    topic: 'informal letter writing',
    text: 'Which feature belongs to an informal letter rather than a formal letter?',
    options: [
      'A capitalised subject line',
      'Receiver’s official address on the left',
      'A relaxed, conversational tone with a first-name greeting',
      'Ending with "Yours faithfully"',
    ],
    correctIndex: 2,
    explanation: [
      'Informal letters are written to friends or family, so they use a warm first-name greeting and everyday tone.',
      'Subject lines and "Yours faithfully" belong to formal letters.',
    ],
  },

  // GNS 103
  {
    courseCode: 'GNS 103',
    topic: 'library sections reference serials',
    text: 'Which section of a university library houses dictionaries, encyclopaedias, and atlases that cannot be borrowed home?',
    options: ['Circulation desk', 'Reference section', 'Serials section', 'Binding unit'],
    correctIndex: 1,
    explanation: [
      'The Reference section keeps quick-consultation materials meant strictly for in-library use.',
      'Books for borrowing are processed at the Circulation desk.',
    ],
  },
  {
    courseCode: 'GNS 103',
    topic: 'dewey decimal classification',
    text: 'Under the Dewey Decimal Classification system, class 500 covers:',
    options: [
      'Philosophy and psychology',
      'Literature',
      'Natural sciences and mathematics',
      'History and geography',
    ],
    correctIndex: 2,
    explanation: [
      'In Dewey Decimal Classification, 500 is Natural sciences and mathematics (e.g., 510 Mathematics, 516 Geometry).',
      '100 is Philosophy, 800 is Literature, and 900 is History and geography.',
    ],
  },
  {
    courseCode: 'GNS 103',
    topic: 'dewey decimal classification classes',
    text: 'Which Dewey Decimal range corresponds to Technology (Applied Sciences)?',
    options: ['200–299', '400–499', '600–699', '800–899'],
    correctIndex: 2,
    explanation: [
      'Class 600–699 represents Technology and applied sciences.',
      '200 is Religion, 400 is Language, and 800 is Literature.',
    ],
  },
  {
    courseCode: 'GNS 103',
    topic: 'sq3r study skills',
    text: 'What does the "SQ3R" study method stand for?',
    options: [
      'Scan, Quote, Read, Repeat, Revise',
      'Survey, Question, Read, Recite, Review',
      'Study, Quiz, Rewrite, Remember, Rest',
      'Skim, Question, Record, Revise, Report',
    ],
    correctIndex: 1,
    explanation: [
      'SQ3R stands for Survey, Question, Read, Recite, and Review.',
      'It turns passive reading into an active revision routine.',
    ],
  },
  {
    courseCode: 'GNS 103',
    topic: 'ict operating system browser search engine',
    text: 'Which of the following is an example of a web browser rather than a search engine?',
    options: ['Google Search', 'Mozilla Firefox', 'Bing', 'DuckDuckGo'],
    correctIndex: 1,
    explanation: [
      'A web browser (like Firefox, Chrome, or Safari) is the application used to open and display web pages.',
      'Google Search, Bing, and DuckDuckGo are search engines that index websites.',
    ],
  },
  {
    courseCode: 'GNS 103',
    topic: 'ict input output hardware',
    text: 'Which group contains ONLY computer output devices?',
    options: [
      'Keyboard, mouse, scanner',
      'Monitor, printer, speakers',
      'Webcam, microphone, monitor',
      'Scanner, printer, keyboard',
    ],
    correctIndex: 1,
    explanation: [
      'Output devices present processed information to the user (monitor, printer, speakers).',
      'Keyboard, mouse, scanner, and microphone are input devices.',
    ],
  },
  {
    courseCode: 'GNS 103',
    topic: 'library serials reserve',
    text: 'Journals, magazines, and newspapers published at regular intervals are kept in which library section?',
    options: ['Special collections', 'Serials section', 'Circulation desk', 'Catalogue room'],
    correctIndex: 1,
    explanation: [
      'Serials are publications issued in successive parts (daily, monthly, or quarterly), such as journals and newspapers.',
    ],
  },
  {
    courseCode: 'GNS 103',
    topic: 'cloud storage online safety',
    text: 'What is the main advantage of cloud storage such as Google Drive or Dropbox?',
    options: [
      'It replaces the computer’s physical monitor.',
      'Files stay accessible online across different devices and stay safe if one device fails.',
      'It eliminates the need for passwords.',
      'It automatically writes exam essays.',
    ],
    correctIndex: 1,
    explanation: [
      'Cloud storage stores files on remote servers so you can access and back them up from any internet-connected device.',
    ],
  },
];

const BOOL_BANK: BoolSeed[] = [
  // GNS 101
  {
    courseCode: 'GNS 101',
    topic: 'concord uncountable nouns',
    text: 'Uncountable nouns such as "advice", "information", and "equipment" normally take singular verbs and never take a plural "-s".',
    correctBoolean: true,
    explanation: ['Nouns like advice, information, furniture, and equipment are uncountable in standard English.'],
  },
  {
    courseCode: 'GNS 101',
    topic: 'skimming scanning reading',
    text: 'Skimming involves reading every word slowly and carefully to memorise complex definitions.',
    correctBoolean: false,
    explanation: ['Skimming is fast reading for the overall gist; slow, careful reading is intensive reading.'],
  },
  {
    courseCode: 'GNS 101',
    topic: 'concord subject verb agreement',
    text: 'In "The box of pencils is on the table", the verb agrees with "box" rather than "pencils".',
    correctBoolean: true,
    explanation: ['A verb agrees with the head noun of its subject ("box"), not the nearest word in a prepositional phrase.'],
  },
  {
    courseCode: 'GNS 101',
    topic: 'clauses grammar',
    text: 'A dependent (subordinate) clause can stand alone as a complete sentence.',
    correctBoolean: false,
    explanation: ['Only an independent (main) clause can stand alone; a dependent clause relies on a main clause.'],
  },
  {
    courseCode: 'GNS 101',
    topic: 'tenses comparatives grammar',
    text: 'Saying "more better" is grammatically acceptable in formal academic writing.',
    correctBoolean: false,
    explanation: ['"More better" is a double comparative error; "better" is already comparative.'],
  },
  {
    courseCode: 'GNS 101',
    topic: 'memorandum formal writing',
    text: 'A formal memorandum typically includes TO, FROM, DATE, and SUBJECT in its heading.',
    correctBoolean: true,
    explanation: ['Internal university and office memos open with TO, FROM, DATE, and SUBJECT lines.'],
  },
  {
    courseCode: 'GNS 101',
    topic: 'concord collective noun',
    text: 'Words like "mathematics", "news", and "physics" take plural verbs because they end in "-s".',
    correctBoolean: false,
    explanation: ['Despite ending in "-s", news, mathematics, and physics are singular in meaning and take singular verbs.'],
  },
  {
    courseCode: 'GNS 101',
    topic: 'comprehension reading',
    text: 'When answering comprehension questions, you should base your answers strictly on the passage rather than personal opinion.',
    correctBoolean: true,
    explanation: ['Comprehension tests understanding of the author’s passage, not outside assumptions.'],
  },

  // GNS 102
  {
    courseCode: 'GNS 102',
    topic: 'formal letter salutation',
    text: 'A formal letter addressed to "Dear Sir/Madam" should end with "Yours sincerely".',
    correctBoolean: false,
    explanation: ['"Dear Sir/Madam" pairs with "Yours faithfully"; "Yours sincerely" is used when you know the recipient’s name.'],
  },
  {
    courseCode: 'GNS 102',
    topic: 'summary writing',
    text: 'Effective summary writing omits lengthy illustrations, examples, and repetition.',
    correctBoolean: true,
    explanation: ['A summary condenses a passage to its core points in fewer words, excluding examples and padding.'],
  },
  {
    courseCode: 'GNS 102',
    topic: 'run-on sentences punctuation',
    text: 'Joining two complete sentences using only a comma produces a run-on (comma splice) error.',
    correctBoolean: true,
    explanation: ['Two independent clauses require a period, semicolon, or conjunction—not just a comma.'],
  },
  {
    courseCode: 'GNS 102',
    topic: 'affect effect',
    text: 'In standard usage, "affect" is usually a noun and "effect" is usually a verb.',
    correctBoolean: false,
    explanation: ['It is the reverse: "affect" is usually the verb (to influence) and "effect" is usually the noun (result).'],
  },
  {
    courseCode: 'GNS 102',
    topic: 'informal letter',
    text: 'An informal letter requires both the sender’s address and the receiver’s official address.',
    correctBoolean: false,
    explanation: ['Only formal letters include the receiver’s address; informal letters include only the sender’s address and date.'],
  },
  {
    courseCode: 'GNS 102',
    topic: 'essay writing',
    text: 'Using SMS shorthand and slang is acceptable in university essay examinations as long as the meaning is clear.',
    correctBoolean: false,
    explanation: ['Exam essays require formal, complete standard English without slang or text-message abbreviations.'],
  },
  {
    courseCode: 'GNS 102',
    topic: 'its it\'s',
    text: '"Its" without an apostrophe shows possession, whereas "it’s" means "it is".',
    correctBoolean: true,
    explanation: ['"It’s" is a contraction of "it is" or "it has"; "its" is the possessive determiner.'],
  },

  // GNS 103
  {
    courseCode: 'GNS 103',
    topic: 'library reference section',
    text: 'Dictionaries and encyclopaedias in the library Reference section are meant for use inside the library only.',
    correctBoolean: true,
    explanation: ['Reference works stay in the library so every student can consult them at any time.'],
  },
  {
    courseCode: 'GNS 103',
    topic: 'dewey decimal classification',
    text: 'The Dewey Decimal Classification divides all knowledge into ten main classes numbered 000 to 999.',
    correctBoolean: true,
    explanation: ['Dewey organises subjects into 10 broad classes (000–900) with decimal subdivisions for detail.'],
  },
  {
    courseCode: 'GNS 103',
    topic: 'ict hardware software',
    text: 'An operating system such as Windows or Android is classified as computer hardware.',
    correctBoolean: false,
    explanation: ['Operating systems are system software; hardware refers to physical parts like monitors and keyboards.'],
  },
  {
    courseCode: 'GNS 103',
    topic: 'library reserve section',
    text: 'The Reserve section lends high-demand textbooks for short periods so more students can access them.',
    correctBoolean: true,
    explanation: ['Reserve collections restrict loan duration for heavily requested course texts.'],
  },
  {
    courseCode: 'GNS 103',
    topic: 'ict browser search engine',
    text: 'A web browser and a search engine perform the exact same function.',
    correctBoolean: false,
    explanation: ['A browser (e.g., Chrome) displays websites, while a search engine (e.g., Google) finds web pages by keyword.'],
  },
  {
    courseCode: 'GNS 103',
    topic: 'study skills sq3r',
    text: 'Writing brief notes in your own words helps retention better than passively rereading pages.',
    correctBoolean: true,
    explanation: ['Active recall and summarising in your own words strengthens memory and exam readiness.'],
  },
  {
    courseCode: 'GNS 103',
    topic: 'online safety passwords',
    text: 'Reusing the exact same simple password across all university and email accounts is recommended for convenience.',
    correctBoolean: false,
    explanation: ['Each important account should use a strong, unique password to prevent a single breach compromising everything.'],
  },
];

// ---------------------------------------------------------------------------
// Exam Builders
// ---------------------------------------------------------------------------

interface Candidate {
  doc: PastQuestionDoc;
  index: number;
  text: string;
  words: Set<string>;
  score: number;
  reasons: string[];
}

function buildTheoryQuestions(
  docs: PastQuestionDoc[],
  spec: ExamSpec,
  materials: StudyMaterial[] = STUDY_MATERIALS
): BuiltExam {
  const scoped = docs.filter((d) => spec.courseCode === ALL_COURSES || d.courseCode === spec.courseCode);

  const candidates: Candidate[] = [];
  for (const doc of scoped) {
    doc.questions.forEach((raw, index) => {
      const text = stripLabel(raw);
      if (text.length < 8) return;
      candidates.push({ doc, index, text, words: tokens(text), score: 0, reasons: [] });
    });
  }

  const newestYear = Math.max(0, ...scoped.map((d) => d.year));
  const oldestYear = Math.min(newestYear, ...scoped.map((d) => d.year));
  const focusWords = Array.from(tokens(spec.focus));

  const repeats = candidates.map((c) =>
    candidates.filter((o) => o.doc.id !== c.doc.id && shared(c.words, o.words) >= 2).length
  );
  const maxRepeat = Math.max(1, ...repeats);

  candidates.forEach((c, i) => {
    const recency = newestYear === oldestYear ? 0.5 : (c.doc.year - oldestYear) / (newestYear - oldestYear);
    c.score += recency * 0.8;
    if (repeats[i] > 0) {
      c.score += (repeats[i] / maxRepeat) * 1.2 + 0.3;
      c.reasons.push('Theme keeps coming back');
    }
    if (newestYear > 0 && c.doc.year === newestYear && newestYear !== oldestYear) {
      c.reasons.push(`Latest session (${c.doc.session})`);
    }
    if (focusWords.length > 0) {
      const hit = focusWords.filter((w) => c.words.has(w) || c.text.toLowerCase().includes(w)).length;
      if (hit > 0) {
        c.score += 2 + hit * 0.5;
        c.reasons.unshift('Matches your topic');
      }
    }
    c.score += Math.random() * 0.35;
  });

  const picked = [...candidates]
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(spec.questionCount, candidates.length));

  picked.sort(
    (a, b) =>
      a.doc.courseCode.localeCompare(b.doc.courseCode, undefined, { numeric: true }) ||
      b.doc.year - a.doc.year ||
      a.index - b.index
  );

  const questions: ExamQuestion[] = picked.map((c, i) => ({
    id: `${c.doc.id}#${c.index}`,
    number: i + 1,
    text: c.text,
    courseCode: c.doc.courseCode,
    source: `${c.doc.courseCode} · ${c.doc.session}`,
    solution: c.doc.solutions?.[c.index] ?? null,
    reasons: c.reasons.slice(0, 2),
  }));

  // If user selected a custom count larger than the archive pool, supplement from reading guides
  if (questions.length < spec.questionCount) {
    const mats = materials.filter(
      (m) =>
        (m.status ?? 'published') === 'published' &&
        (spec.courseCode === ALL_COURSES || m.courseCode === spec.courseCode)
    );
    const extras: ExamQuestion[] = [];
    for (const mat of mats) {
      for (const sec of mat.sections) {
        const pts = sec.points ?? [];
        const para = sec.paragraphs?.[0] ?? '';
        extras.push({
          id: `guide-${mat.id}-${sec.heading.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
          number: 0,
          text: `Discuss "${sec.heading}" in ${mat.courseCode}, highlighting at least three key points expected in the examination.`,
          courseCode: mat.courseCode,
          source: `${mat.courseCode} · Study Guide`,
          solution: {
            answer: para || pts[0] || `Key revision points for ${sec.heading}.`,
            explanation: pts.slice(0, 4),
          },
          reasons: ['From reading guide'],
        });
      }
    }
    // Score extras by focus
    extras.sort((a, b) => {
      const aHit = focusWords.filter((w) => a.text.toLowerCase().includes(w)).length;
      const bHit = focusWords.filter((w) => b.text.toLowerCase().includes(w)).length;
      return bHit - aHit || Math.random() - 0.5;
    });

    for (const ex of extras) {
      if (questions.length >= spec.questionCount) break;
      questions.push({ ...ex, number: questions.length + 1 });
    }
  }

  return {
    examType: 'theory',
    poolSize: candidates.length,
    questions: questions.map((q, idx) => ({ ...q, number: idx + 1 })),
  };
}

function buildMcqOrBooleanFallbackFromDocs(
  docs: PastQuestionDoc[],
  spec: ExamSpec
): ExamQuestion[] {
  const scoped = docs.filter((d) => spec.courseCode === ALL_COURSES || d.courseCode === spec.courseCode);
  const out: ExamQuestion[] = [];
  for (const doc of scoped) {
    doc.questions.forEach((raw, idx) => {
      const qText = stripLabel(raw);
      const sol = doc.solutions?.[idx];
      if (!qText || !sol) return;
      if (spec.examType === 'boolean') {
        out.push({
          id: `dyn-bool-${doc.id}-${idx}`,
          number: out.length + 1,
          text: `True or False: ${sol.answer}`,
          courseCode: doc.courseCode,
          source: `${doc.courseCode} · ${doc.session}`,
          correctBoolean: true,
          solution: sol,
          reasons: ['Based on past question'],
        });
      } else {
        out.push({
          id: `dyn-mcq-${doc.id}-${idx}`,
          number: out.length + 1,
          text: `Which of the following best answers: "${qText}"`,
          courseCode: doc.courseCode,
          source: `${doc.courseCode} · ${doc.session}`,
          options: [
            sol.answer,
            'None of the stated academic principles apply.',
            'It applies strictly to informal spoken dialogue only.',
            'Only the historical background is required without examples.',
          ],
          correctIndex: 0,
          solution: sol,
          reasons: ['Based on past question'],
        });
      }
    });
  }
  return out;
}

export const buildExam = (
  docs: PastQuestionDoc[],
  spec: ExamSpec,
  materials: StudyMaterial[] = STUDY_MATERIALS
): BuiltExam => {
  const archivePool = countQuestionsFor(docs, spec.courseCode);

  if (spec.examType === 'theory') {
    return buildTheoryQuestions(docs, spec, materials);
  }

  const focusWords = Array.from(tokens(spec.focus));

  if (spec.examType === 'boolean') {
    const scoped = BOOL_BANK.filter(
      (b) => spec.courseCode === ALL_COURSES || b.courseCode === spec.courseCode
    );
    const ranked = scoped
      .map((item, idx) => {
        const hay = `${item.topic} ${item.text}`.toLowerCase();
        const hit = focusWords.filter((w) => hay.includes(w)).length;
        return {
          item,
          idx,
          hit,
          score: hit * 3 + Math.random(),
        };
      })
      .sort((a, b) => b.score - a.score);

    let questions: ExamQuestion[] = ranked.map((r, i) => ({
      id: `bool-${r.item.courseCode}-${r.idx}-${i}`,
      number: i + 1,
      text: r.item.text,
      courseCode: r.item.courseCode,
      source: `${r.item.courseCode} · Practice Bank`,
      correctBoolean: r.item.correctBoolean,
      solution: {
        answer: r.item.correctBoolean ? 'True' : 'False',
        explanation: r.item.explanation,
      },
      reasons: r.hit > 0 ? ['Matches your topic'] : ['Core exam theme'],
    }));

    if (questions.length === 0) {
      questions = buildMcqOrBooleanFallbackFromDocs(docs, spec);
    }

    // If student picked a custom count larger than bank size, cycle with fresh numbering
    if (questions.length > 0 && questions.length < spec.questionCount) {
      const base = [...questions];
      while (questions.length < spec.questionCount) {
        const next = base[questions.length % base.length];
        questions.push({
          ...next,
          id: `${next.id}-rep-${questions.length}`,
          number: questions.length + 1,
        });
      }
    }

    return {
      examType: 'boolean',
      poolSize: archivePool,
      questions: questions.slice(0, spec.questionCount).map((q, i) => ({ ...q, number: i + 1 })),
    };
  }

  // OBJ or CBT
  const scoped = MCQ_BANK.filter(
    (m) => spec.courseCode === ALL_COURSES || m.courseCode === spec.courseCode
  );
  const ranked = scoped
    .map((item, idx) => {
      const hay = `${item.topic} ${item.text}`.toLowerCase();
      const hit = focusWords.filter((w) => hay.includes(w)).length;
      return {
        item,
        idx,
        hit,
        score: hit * 3 + Math.random(),
      };
    })
    .sort((a, b) => b.score - a.score);

  let questions: ExamQuestion[] = ranked.map((r, i) => {
    const letter = ['A', 'B', 'C', 'D'][r.item.correctIndex];
    return {
      id: `mcq-${r.item.courseCode}-${r.idx}-${i}`,
      number: i + 1,
      text: r.item.text,
      courseCode: r.item.courseCode,
      source: `${r.item.courseCode} · Practice Bank`,
      options: [...r.item.options],
      correctIndex: r.item.correctIndex,
      solution: {
        answer: `${letter}. ${r.item.options[r.item.correctIndex]}`,
        explanation: r.item.explanation,
      },
      reasons: r.hit > 0 ? ['Matches your topic'] : ['Core exam theme'],
    };
  });

  if (questions.length === 0) {
    questions = buildMcqOrBooleanFallbackFromDocs(docs, spec);
  }

  if (questions.length > 0 && questions.length < spec.questionCount) {
    const base = [...questions];
    while (questions.length < spec.questionCount) {
      const next = base[questions.length % base.length];
      questions.push({
        ...next,
        id: `${next.id}-rep-${questions.length}`,
        number: questions.length + 1,
      });
    }
  }

  return {
    examType: spec.examType,
    poolSize: archivePool,
    questions: questions.slice(0, spec.questionCount).map((q, i) => ({ ...q, number: i + 1 })),
  };
};
