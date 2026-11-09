/**
 * CALLFORGE AI — Demo & Fixture Loader
 * v0.2 Simulation Baseline
 *
 * Loads deterministic Arabic/English conversation fixtures
 * for testing and demonstration purposes.
 */

import { initDatabase, getDatabase, closeStore, generateId } from './store.mjs';
import { createAuditLogger } from './audit.mjs';

const FIXTURES = {
  en: {
    appointment_booking: {
      scenario: 'appointment_booking',
      turns: [
        {
          role: 'agent',
          text: 'Hello! Thank you for calling Dubai Dental Clinic. How can I help you today?',
        },
        { role: 'user', text: "Hi, I'd like to book a teeth cleaning appointment." },
        {
          role: 'agent',
          text: 'Certainly! I can help you with that. Do you have a preferred date and time?',
        },
        { role: 'user', text: 'Next Tuesday morning would be great, around 10 AM.' },
        {
          role: 'agent',
          text: 'Let me check availability for Tuesday at 10 AM. One moment please.',
        },
        {
          role: 'agent',
          text: 'Great news! We have an opening on Tuesday at 10:00 AM. Would you like me to book that for you?',
        },
        { role: 'user', text: 'Yes, please book it.' },
        {
          role: 'agent',
          text: "Perfect! I've booked your teeth cleaning for Tuesday at 10:00 AM. You'll receive a confirmation SMS shortly. Is there anything else I can help you with?",
        },
        { role: 'user', text: "No, that's all. Thank you!" },
        { role: 'agent', text: "You're welcome! Have a great day!" },
      ],
      expected_outcome: 'appointment_booked',
    },
    faq_inquiry: {
      scenario: 'faq_inquiry',
      turns: [
        {
          role: 'agent',
          text: 'Thank you for calling Emirates Real Estate. How may I assist you?',
        },
        { role: 'user', text: 'What are your office hours?' },
        {
          role: 'agent',
          text: "Our office hours are Sunday through Thursday, 9 AM to 6 PM. We're closed on Fridays and Saturdays.",
        },
        { role: 'user', text: 'Do you offer virtual property tours?' },
        {
          role: 'agent',
          text: 'Yes, we offer virtual tours for all our listed properties. You can schedule one through our website or I can arrange it for you now.',
        },
        { role: 'user', text: "That's helpful, thank you." },
        {
          role: 'agent',
          text: "You're welcome! Would you like me to schedule a virtual tour for any specific property?",
        },
        { role: 'user', text: "Not right now, but I'll check the website." },
        {
          role: 'agent',
          text: 'Absolutely. Feel free to call back anytime. Have a wonderful day!',
        },
      ],
      expected_outcome: 'information_provided',
    },
    lead_qualification: {
      scenario: 'lead_qualification',
      turns: [
        {
          role: 'agent',
          text: "Hello! This is Sarah from AutoPro Motors. I'm following up on your inquiry about the 2024 Toyota Camry.",
        },
        { role: 'user', text: 'Oh, yes. I was looking at that model.' },
        {
          role: 'agent',
          text: "Great! To help me find the best options for you, may I ask what's your target budget range?",
        },
        { role: 'user', text: 'Around 100,000 to 120,000 AED.' },
        {
          role: 'agent',
          text: 'Perfect, that aligns well with the Camry trims we have available. Are you looking to purchase or lease?',
        },
        { role: 'user', text: 'Purchase, preferably.' },
        { role: 'agent', text: 'Excellent. Do you have a trade-in vehicle?' },
        { role: 'user', text: 'Yes, a 2019 Nissan Altima.' },
        {
          role: 'agent',
          text: "Great! I'll have our sales team prepare a detailed quote including trade-in value. What's the best number to reach you?",
        },
        { role: 'user', text: '050-123-4567.' },
        {
          role: 'agent',
          text: 'Thank you! Our team will call you within 2 hours. Have a great day!',
        },
      ],
      expected_outcome: 'lead_qualified',
    },
    customer_support: {
      scenario: 'customer_support',
      turns: [
        {
          role: 'agent',
          text: 'Welcome to TechSolutions Support. My name is Alex. How can I help you?',
        },
        { role: 'user', text: 'My internet has been down since this morning.' },
        {
          role: 'agent',
          text: "I'm sorry to hear that. Let me check your account and run a line test. Can I get your account number or registered phone number?",
        },
        { role: 'user', text: "It's 04-123-4567." },
        {
          role: 'agent',
          text: "Thank you. I see your account. Running a diagnostic now... I'm detecting an issue with the ONT device. Let me schedule a technician visit.",
        },
        { role: 'user', text: 'How soon can someone come?' },
        {
          role: 'agent',
          text: 'We have availability tomorrow between 9 AM and 1 PM. Does that work for you?',
        },
        { role: 'user', text: 'Tomorrow morning is fine.' },
        {
          role: 'agent',
          text: "Booked for tomorrow 9 AM to 1 PM. You'll receive a confirmation SMS. Is there anything else?",
        },
        { role: 'user', text: 'No, thanks.' },
        {
          role: 'agent',
          text: "You're welcome. We apologize for the inconvenience. Have a good day!",
        },
      ],
      expected_outcome: 'ticket_created',
    },
  },
  ar: {
    appointment_booking: {
      scenario: 'appointment_booking',
      turns: [
        {
          role: 'agent',
          text: 'مرحباً! شكراً لاتصالك بعيادة دبي للأسنان. كيف يمكنني مساعدتك اليوم؟',
        },
        { role: 'user', text: 'أهلاً، أود حجز موعد لتنظيف الأسنان.' },
        { role: 'agent', text: 'بالتأكيد! يمكنني مساعدتك في ذلك. هل لديك تاريخ ووقت مفضل؟' },
        { role: 'user', text: 'الثلاثاء القادم صباحاً سيكون رائعاً، حوالي الساعة 10 صباحاً.' },
        {
          role: 'agent',
          text: 'دعني أتحقق من توفر الموعد للثلاثاء الساعة 10 صباحاً. لحظة من فضلك.',
        },
        {
          role: 'agent',
          text: 'أخبار رائعة! يتوفر موعد يوم الثلاثاء الساعة 10:00 صباحاً. هل تريدني أن أحجزه لك؟',
        },
        { role: 'user', text: 'نعم، من فضلك احجزه.' },
        {
          role: 'agent',
          text: 'ممتاز! لقد حجزت موعد تنظيف الأسنان يوم الثلاثاء الساعة 10:00 صباحاً. ستحصل على رسالة تأكيد عبر الرسائل النصية قريباً. هل هناك أي شيء آخر يمكنني مساعدتك فيه؟',
        },
        { role: 'user', text: 'لا، هذا كل شيء. شكراً!' },
        { role: 'agent', text: 'على الرحب والسعة! أتمنى لك يوماً سعيداً!' },
      ],
      expected_outcome: 'appointment_booked',
    },
    faq_inquiry: {
      scenario: 'faq_inquiry',
      turns: [
        { role: 'agent', text: 'شكراً لاتصالك بشركة الإمارات للعقارات. كيف يمكنني مساعدتك؟' },
        { role: 'user', text: 'ما هي ساعات العمل لديكم؟' },
        {
          role: 'agent',
          text: 'ساعات عملنا من الأحد إلى الخميس، من الساعة 9 صباحاً حتى 6 مساءً. نحن مغلقون يومي الجمعة والسبت.',
        },
        { role: 'user', text: 'هل تقدمون جولات افتراضية للعقارات؟' },
        {
          role: 'agent',
          text: 'نعم، نقدم جولات افتراضية لجميع العقارات المدرجة. يمكنك حجز واحدة عبر موقعنا أو يمكنني ترتيبها لك الآن.',
        },
        { role: 'user', text: 'هذا مفيد، شكراً.' },
        { role: 'agent', text: 'على الرحب! هل تريدني أن أحجز جولة افتراضية لعقار معين؟' },
        { role: 'user', text: 'ليس الآن، لكن سأتحقق من الموقع.' },
        {
          role: 'agent',
          text: 'بالتأكيد. لا تتردد في الاتصال بنا في أي وقت. أتمنى لك يوماً رائعاً!',
        },
      ],
      expected_outcome: 'information_provided',
    },
    lead_qualification: {
      scenario: 'lead_qualification',
      turns: [
        {
          role: 'agent',
          text: 'مرحباً! هذه سارة من أوتو برو موتورز. أتابع استفسارك حول تويوتا كامري 2024.',
        },
        { role: 'user', text: 'أوه، نعم. كنت أنظر في هذا الموديل.' },
        {
          role: 'agent',
          text: 'ممتاز! لمساعدتي في إيجاد أفضل الخيارات لك، هل يمكنني أن أسأل عن نطاق الميزانية المستهدف؟',
        },
        { role: 'user', text: 'حوالي 100,000 إلى 120,000 درهم.' },
        {
          role: 'agent',
          text: 'مثالي، هذا يتماشى جيداً مع فئات الكامري المتاحة لدينا. هل تبحث عن شراء أم تأجير؟',
        },
        { role: 'user', text: 'الشراء، يفضل.' },
        { role: 'agent', text: 'ممتاز. هل لديك سيارة للاستبدال؟' },
        { role: 'user', text: 'نعم، نيسان ألتيما 2019.' },
        {
          role: 'agent',
          text: 'رائع! سأطلب من فريق المبيعات إعداد عرض سعر مفصل يشمل قيمة الاستبدال. ما هو أفضل رقم للتواصل معك؟',
        },
        { role: 'user', text: '050-123-4567.' },
        { role: 'agent', text: 'شكراً! سيتصل بك فريقنا خلال ساعتين. أتمنى لك يوماً سعيداً!' },
      ],
      expected_outcome: 'lead_qualified',
    },
    customer_support: {
      scenario: 'customer_support',
      turns: [
        { role: 'agent', text: 'مرحباً بك في دعم تك سوليوشنز. اسمي أليكس. كيف يمكنني مساعدتك؟' },
        { role: 'user', text: 'الإنترنت معطل منذ هذا الصباح.' },
        {
          role: 'agent',
          text: 'أعتذر لسماع ذلك. دعني أتحقق من حسابك وأجري اختباراً للخط. هل يمكنني الحصول على رقم حسابك أو رقم الهاتف المسجل؟',
        },
        { role: 'user', text: 'هو 04-123-4567.' },
        {
          role: 'agent',
          text: 'شكراً. أرى حسابك. أجري تشخيصاً الآن... أكتشف مشكلة في جهاز ONT. دعني أحدد موعداً لزيارة فني.',
        },
        { role: 'user', text: 'ما مدى سرعة مجيء أحد؟' },
        { role: 'agent', text: 'لدينا توفر غداً بين الساعة 9 صباحاً و 1 ظهراً. هل يناسبك ذلك؟' },
        { role: 'user', text: 'غداً صباحاً مناسب.' },
        {
          role: 'agent',
          text: 'تم الحجز لغداً من 9 صباحاً إلى 1 ظهراً. ستحصل على رسالة تأكيد عبر الرسائل النصية. هل هناك أي شيء آخر؟',
        },
        { role: 'user', text: 'لا، شكراً.' },
        { role: 'agent', text: 'على الرحب. نعتذر عن الإزعاج. أتمنى لك يوماً طيباً!' },
      ],
      expected_outcome: 'ticket_created',
    },
  },
};

async function loadFixtures() {
  console.log('Loading conversation fixtures...');

  await initDatabase();
  const db = getDatabase();
  const auditLogger = createAuditLogger();

  let loaded = 0;

  for (const [language, scenarios] of Object.entries(FIXTURES)) {
    for (const [scenarioKey, fixture] of Object.entries(scenarios)) {
      const existing = db
        .prepare('SELECT id FROM conversation_fixtures WHERE language = ? AND scenario = ?')
        .get(language, scenarioKey);

      if (existing) {
        console.log(`  Fixture exists: ${language}/${scenarioKey}`);
        continue;
      }

      const id = generateId();
      db.prepare(
        'INSERT INTO conversation_fixtures (id, language, scenario, turns, expected_outcome) VALUES (?, ?, ?, ?, ?)',
      ).run(id, language, scenarioKey, JSON.stringify(fixture.turns), fixture.expected_outcome);

      await auditLogger.log({
        event_type: 'fixture_loaded',
        actor_type: 'system',
        action: 'load_fixture',
        resource_type: 'conversation_fixture',
        resource_id: id,
        payload: { language, scenario: scenarioKey },
      });

      console.log(`  Loaded: ${language}/${scenarioKey} (${fixture.turns.length} turns)`);
      loaded++;
    }
  }

  console.log(
    `Fixtures loaded: ${loaded} new, ${Object.keys(FIXTURES.en).length + Object.keys(FIXTURES.ar).length - loaded} existing`,
  );
}

async function runDemo() {
  console.log('\n=== CALLFORGE v0.2 Demo ===\n');

  await loadFixtures();

  const db = getDatabase();

  // Show all fixtures
  const fixtures = db
    .prepare('SELECT language, scenario, expected_outcome FROM conversation_fixtures')
    .all();
  console.log('\nAvailable Fixtures:');
  for (const f of fixtures) {
    console.log(`  ${f.language}/${f.scenario} → ${f.expected_outcome}`);
  }

  // Show sample conversation
  console.log('\nSample Conversation (EN - appointment_booking):');
  const sample = db
    .prepare('SELECT turns FROM conversation_fixtures WHERE language = ? AND scenario = ?')
    .get('en', 'appointment_booking');
  if (sample) {
    const turns = JSON.parse(sample.turns);
    for (const turn of turns) {
      console.log(`  [${turn.role.toUpperCase()}]: ${turn.text}`);
    }
  }

  console.log('\n=== Demo Complete ===');
  await closeStore();
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runDemo().catch(console.error);
}

export { FIXTURES, loadFixtures };
