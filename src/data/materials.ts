import type { StudyMaterial } from '../core/types';

/**
 * Reading guides for exam preparation. These are study notes, not past
 * questions: each one explains the ideas a course tests, in the order a
 * student would revise them.
 */
export const STUDY_MATERIALS: StudyMaterial[] = [
  {
    id: 'mat-gns101-english-1',
    courseCode: 'GNS 101',
    courseTitle: 'Use of English & Communication Skills',
    level: '100L',
    title: 'Use of English I: Exam Reading Guide',
    summary:
      'The grammar, comprehension and writing skills most often tested in first-semester English.',
    readMinutes: 8,
    sections: [
      {
        heading: 'What the exam usually tests',
        paragraphs: [
          'Use of English papers usually mix grammar and usage, reading comprehension, vocabulary and a short piece of writing. Check your course outline for the exact split, then spend your revision time where the marks are.',
        ],
        points: [
          'Grammar and usage: concord, tenses, parts of speech and sentence structure.',
          'Comprehension: answering questions on a passage.',
          'Vocabulary: word meanings, opposites and choosing the right word.',
          'Writing: a letter, an essay or a summary.',
        ],
      },
      {
        heading: 'Parts of speech at a glance',
        points: [
          'Noun: names a person, place, thing or idea (lecturer, Akure, honesty).',
          'Pronoun: replaces a noun (he, they, which).',
          'Verb: shows an action or a state (write, is).',
          'Adjective: describes a noun (large, careful).',
          'Adverb: describes a verb, an adjective or another adverb (quickly, very).',
          'Preposition: links a noun to the rest of the sentence (in, on, between).',
          'Conjunction: joins words or clauses (and, but, because).',
          'Interjection: shows sudden feeling (Oh!, Wow!).',
        ],
      },
      {
        heading: 'Concord: making verbs agree',
        paragraphs: [
          'A verb must agree with its subject in number. It does not agree with the word nearest to it.',
        ],
        points: [
          'The box of pencils is on the desk. The subject is box, not pencils.',
          'Each of the students has a copy. Each is singular.',
          'Neither the lecturer nor the students were late. With neither/nor, the verb agrees with the nearer subject.',
          'News, mathematics and physics take singular verbs.',
          'A collective noun such as team or committee is singular when it acts as one unit.',
        ],
      },
      {
        heading: 'Tenses and common errors',
        points: [
          'Use the simple past for finished actions: She submitted the form yesterday.',
          'Use the present perfect for actions linked to now: I have finished my assignment.',
          'Do not switch tenses in one sentence without a reason.',
          'Avoid double comparatives: say better, not more better.',
          'Uncountable nouns such as advice, information, furniture and equipment take no plural s.',
        ],
      },
      {
        heading: 'How to answer comprehension questions',
        points: [
          'Read the questions first, then the passage.',
          'Read once for the main idea, then again slowly for detail.',
          'Answer in complete sentences, in your own words, unless the question asks you to quote.',
          'For vocabulary questions, put your chosen word back into the sentence to test it.',
          'Check every answer against the passage, not against your own opinion.',
        ],
      },
      {
        heading: 'A simple revision plan',
        paragraphs: [
          'Short, regular practice works better than one long night before the exam.',
        ],
        points: [
          'Week 1: grammar rules and concord drills.',
          'Week 2: comprehension practice with passages from past papers.',
          'Week 3: write one letter and one essay against the clock.',
          'Last days: redo past questions and study every mistake.',
        ],
      },
    ],
  },
  {
    id: 'mat-gns102-english-2',
    courseCode: 'GNS 102',
    courseTitle: 'Use of English & Communication Skills II',
    level: '100L',
    title: 'Use of English II: Writing Guide',
    summary:
      'Letters, summaries and essays: how to plan them and how to avoid the mistakes that cost marks.',
    readMinutes: 7,
    sections: [
      {
        heading: 'Formal and informal letters',
        paragraphs: [
          'A formal letter goes to someone in authority or someone you do not know. An informal letter goes to family or friends.',
        ],
        points: [
          'Formal: sender address, date, receiver address, Dear Sir/Madam, subject line, Yours faithfully.',
          'Informal: sender address and date, a first-name greeting, relaxed language, Your friend.',
          'Use Yours faithfully after Dear Sir/Madam. Use Yours sincerely after a name.',
        ],
      },
      {
        heading: 'Writing a formal letter step by step',
        points: [
          'Put your address and the date at the top right.',
          'Write the receiver address on the left.',
          'Add a short, capitalised subject line.',
          'Paragraph 1: say why you are writing.',
          'Paragraph 2: give the details that support your request.',
          'Paragraph 3: say what you want to happen next and thank the reader.',
        ],
      },
      {
        heading: 'Summary writing',
        paragraphs: [
          'A summary keeps the main points of a passage, in your own words and in far fewer words.',
        ],
        points: [
          'Find the main idea of each paragraph.',
          'Leave out examples, repetition and decoration.',
          'Do not copy whole sentences from the passage.',
          'Join the points in order with connectors such as also, because and however.',
          'Count your words and stay within the limit.',
        ],
      },
      {
        heading: 'Essay structure',
        points: [
          'Introduction: say what the essay is about in two or three sentences.',
          'Body: one idea per paragraph, each with a point and an example.',
          'Conclusion: bring the ideas together and end firmly.',
          'Give the essay a title and plan for two minutes before you write.',
        ],
      },
      {
        heading: 'Common mistakes to avoid',
        points: [
          'Run-on sentences: two full sentences joined with only a comma.',
          'Affect and effect: affect is usually a verb, effect is usually a noun.',
          'Its and it\'s: its shows ownership, it\'s means it is.',
          'Writing as you speak: avoid slang and text-message spellings in exams.',
          'Not rereading: leave five minutes at the end to check spelling and punctuation.',
        ],
      },
    ],
  },
  {
    id: 'mat-gns103-library-ict',
    courseCode: 'GNS 103',
    courseTitle: 'Use of Library, Study Skills & ICT',
    level: '100L',
    title: 'Library, Study Skills & ICT: Exam Guide',
    summary:
      'How a library is organised, how to study well, and the ICT terms every first-year should know.',
    readMinutes: 7,
    sections: [
      {
        heading: 'Using the library',
        points: [
          'Circulation desk: borrow, return and renew books.',
          'Reference section: dictionaries, encyclopaedias and atlases, used in the library only.',
          'Serials section: journals, magazines and newspapers.',
          'Reserve section: high-demand textbooks lent for a short time.',
          'Catalogue: search by author, title or subject to find a call number, then follow it to the shelf.',
        ],
      },
      {
        heading: 'The Dewey Decimal Classification',
        paragraphs: [
          'Dewey sorts all knowledge into ten classes, numbered 000 to 999. Decimals add detail, so 510 is mathematics and 516 is geometry.',
        ],
        points: [
          '000 General works',
          '100 Philosophy and psychology',
          '200 Religion',
          '300 Social sciences',
          '400 Language',
          '500 Natural sciences and mathematics',
          '600 Technology',
          '700 Arts and recreation',
          '800 Literature',
          '900 History and geography',
        ],
      },
      {
        heading: 'Study skills',
        paragraphs: [
          'The SQ3R method gives reading a routine: Survey the chapter, ask Questions, Read, Recite what you remember, then Review.',
        ],
        points: [
          'Make a weekly timetable and give every course a slot.',
          'Write short notes in your own words, not copied text.',
          'Revise a little every day instead of cramming.',
          'Practise past questions to learn the exam style.',
          'Sleep well the night before an exam.',
        ],
      },
      {
        heading: 'ICT basics',
        points: [
          'Hardware is the physical parts of a computer. Software is the programs that run on it.',
          'Input devices send data in (keyboard, mouse, scanner). Output devices show results (monitor, printer).',
          'An operating system manages the computer, for example Windows or Android.',
          'A browser opens web pages. A search engine finds them from the words you type.',
          'Cloud storage keeps your files online so you can open them from any device.',
        ],
      },
      {
        heading: 'Searching and staying safe online',
        points: [
          'Use specific keywords, and put an exact phrase in quotation marks.',
          'Prefer sources written by named authors, schools or organisations.',
          'Use a strong, different password for each important account.',
          'Do not click links in unexpected messages that ask for your details.',
          'Back up important files in more than one place.',
        ],
      },
    ],
  },
];
