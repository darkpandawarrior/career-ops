export const SOURCE_REGISTRY = Object.freeze([
  source('greenhouse', 'Greenhouse', 'ats', '(site:job-boards.greenhouse.io OR site:boards.greenhouse.io)'),
  source('ashby', 'Ashby', 'ats', 'site:jobs.ashbyhq.com'),
  source('lever', 'Lever', 'ats', 'site:jobs.lever.co'),
  source('workable', 'Workable', 'ats', 'site:apply.workable.com'),
  source('smartrecruiters', 'SmartRecruiters', 'ats', 'site:jobs.smartrecruiters.com'),
  source('workday', 'Workday', 'ats', 'site:myworkdayjobs.com'),
  source('recruitee', 'Recruitee', 'ats', 'site:recruitee.com'),
  source('bamboohr', 'BambooHR', 'ats', 'site:bamboohr.com/careers'),
  source('breezy', 'Breezy HR', 'ats', 'site:breezy.hr'),

  source('company-big-tech', 'Major technology company careers', 'company',
    '(site:careers.google.com OR site:jobs.apple.com OR site:careers.microsoft.com OR site:amazon.jobs OR site:metacareers.com OR site:nvidia.com/en-us/about-nvidia/careers)'),
  source('company-product', 'Global product company careers', 'company',
    '(site:atlassian.com/company/careers OR site:canva.com/careers OR site:stripe.com/jobs OR site:uber.com/careers OR site:careers.airbnb.com OR site:redditinc.com/careers OR site:coinbase.com/careers)'),
  source('company-enterprise', 'Enterprise technology careers', 'company',
    '(site:ibm.com/careers OR site:oracle.com/careers OR site:salesforce.com/company/careers OR site:jobs.sap.com OR site:adobe.com/careers OR site:servicenow.com/careers)'),
  source('company-consulting', 'Consulting and professional-services careers', 'company',
    '(site:accenture.com/careers OR site:deloitte.com/careers OR site:ey.com/careers OR site:kpmg.com/careers OR site:pwc.com/careers OR site:mckinsey.com/careers OR site:careers.bcg.com)'),
  source('company-india-product', 'India product company careers', 'company',
    '(site:razorpay.com/jobs OR site:phonepe.com/careers OR site:postman.com/company/careers OR site:browserstack.com/careers OR site:flipkartcareers.com OR site:careers.swiggy.com OR site:zomato.com/careers OR site:meesho.io/jobs OR site:freshworks.com/company/careers OR site:zoho.com/careers)', {
      scopes: ['local', 'international'],
      countries: ['india'],
    }),

  source('linkedin', 'LinkedIn Jobs', 'aggregator', 'site:linkedin.com/jobs'),
  source('indeed', 'Indeed', 'aggregator', 'site:indeed.com/viewjob'),
  source('glassdoor', 'Glassdoor', 'aggregator', 'site:glassdoor.com/job-listing'),
  source('monster', 'Monster', 'aggregator', 'site:monster.com/job-openings'),
  source('google-jobs', 'Google Jobs indexed listings', 'aggregator',
    '(site:google.com/search "jobs" OR site:careers.google.com)'),
  source('builtin-dice', 'Built In and Dice', 'aggregator',
    '(site:builtin.com/jobs OR site:dice.com/job-detail)'),

  source('early-global', 'Global graduate and internship boards', 'early-career',
    '(site:prosple.com/jobs OR site:gradconnection.com OR site:wayup.com OR site:handshake.com/jobs)', {
      stages: ['early'],
    }),
  source('early-startups', 'Startup internships and entry-level jobs', 'early-career',
    '(site:wellfound.com/jobs OR site:workatastartup.com OR site:ycombinator.com/jobs)', {
      stages: ['early'],
    }),
  source('experienced-startups', 'Experienced startup and scale-up jobs', 'startup',
    '(site:wellfound.com/jobs OR site:workatastartup.com OR site:ycombinator.com/jobs OR site:startup.jobs)', {
      stages: ['experienced'],
    }),
  source('early-research', 'University, research, and fellowship opportunities', 'early-career',
    '(site:euraxess.ec.europa.eu/jobs OR site:academicpositions.com OR site:jobs.ac.uk)', {
      stages: ['early'],
    }),

  source('remote-api-boards', 'RemoteOK, Remotive, and Himalayas', 'remote',
    '(site:remoteok.com OR site:remotive.com OR site:himalayas.app)', { scopes: ['remote'] }),
  source('remote-community', 'We Work Remotely, Working Nomads, and Jobicy', 'remote',
    '(site:weworkremotely.com OR site:workingnomads.com OR site:jobicy.com)', { scopes: ['remote'] }),
  source('remote-curated', 'Remote.co, NoDesk, JustRemote, and Remote Rocketship', 'remote',
    '(site:remote.co/remote-jobs OR site:nodesk.co/remote-jobs OR site:justremote.co OR site:remoterocketship.com)', { scopes: ['remote'] }),
  source('remote-talent', 'Arc, Turing, Contra, and FlexJobs', 'remote',
    '(site:arc.dev/remote-jobs OR site:turing.com/jobs OR site:contra.com/opportunities OR site:flexjobs.com/remote-jobs)', { scopes: ['remote'] }),
  source('remote-europe', 'Europe-focused remote boards', 'remote',
    '(site:arbeitnow.com/jobs OR site:europelanguagejobs.com OR site:remote-europe.com)', { scopes: ['remote'] }),

  source('specialist-engineering', 'Engineering and technical specialist boards', 'specialist',
    '(site:dice.com/job-detail OR site:stackoverflowjobs.com OR site:engineering.com/jobs OR site:techfetch.com/job-description)'),
  source('specialist-design', 'Design and creative specialist boards', 'specialist',
    '(site:dribbble.com/jobs OR site:behance.net/joblist OR site:workingnotworking.com/jobs)'),
  source('specialist-marketing', 'Marketing and growth specialist boards', 'specialist',
    '(site:marketinghire.com/jobs OR site:jobsinmarketing.io OR site:problogger.com/jobs)'),
  source('specialist-sales', 'Sales and customer-success specialist boards', 'specialist',
    '(site:rainmakers.co OR site:salesjobs.com OR site:commissioncrowd.com/jobs)'),
  source('specialist-finance', 'Finance and accounting specialist boards', 'specialist',
    '(site:efinancialcareers.com/jobs OR site:accountingfly.com/jobs OR site:careers.cfainstitute.org)'),
  source('specialist-healthcare', 'Healthcare and life-sciences specialist boards', 'specialist',
    '(site:healthjobsnationwide.com OR site:bioSpace.com/jobs OR site:medzilla.com/jobs)'),
  source('specialist-nonprofit', 'Nonprofit and social-impact boards', 'specialist',
    '(site:idealist.org/en/jobs OR site:devex.com/jobs OR site:reliefweb.int/jobs)'),

  source('india-general', 'India major job portals', 'regional',
    '(site:naukri.com/job-listings OR site:foundit.in/job OR site:in.indeed.com/viewjob OR site:shine.com/jobs OR site:timesjobs.com/job-detail)', {
      scopes: ['local', 'international'], countries: ['india'],
    }),
  source('india-tech', 'India technology and startup portals', 'regional',
    '(site:instahyre.com/job OR site:cutshort.io/job OR site:hirist.tech/j OR site:wellfound.com/jobs)', {
      scopes: ['local', 'international'], countries: ['india'], stages: ['experienced'],
    }),
  source('india-professional', 'India professional and management portals', 'regional',
    '(site:iimjobs.com/j OR site:ambitionbox.com/jobs OR site:hirect.in OR site:apna.co/jobs)', {
      scopes: ['local', 'international'], countries: ['india'],
    }),
  source('india-early', 'India internships and fresher opportunities', 'early-career',
    '(site:internshala.com/internships OR site:internshala.com/jobs OR site:unstop.com/jobs OR site:unstop.com/internships OR site:apna.co/jobs)', {
      scopes: ['local', 'international'], countries: ['india'], stages: ['early'],
    }),
  source('india-government', 'India public-sector and apprenticeship opportunities', 'early-career',
    '(site:nats.education.gov.in OR site:apprenticeshipindia.gov.in OR site:ncs.gov.in)', {
      scopes: ['local'], countries: ['india'], stages: ['early'],
    }),

  source('germany', 'Germany job portals', 'regional',
    '(site:make-it-in-germany.com/en/working-in-germany/job-listings OR site:stepstone.de OR site:honeypot.io OR site:arbeitsagentur.de/jobsuche)', {
      scopes: ['local', 'international'], countries: ['germany'],
    }),
  source('uk', 'United Kingdom job portals', 'regional',
    '(site:reed.co.uk/jobs OR site:totaljobs.com/jobs OR site:cv-library.co.uk OR site:jobs.ac.uk)', {
      scopes: ['local', 'international'], countries: ['uk'],
    }),
  source('canada', 'Canada job portals', 'regional',
    '(site:jobbank.gc.ca/jobsearch OR site:workopolis.com/jobsearch OR site:ca.indeed.com/viewjob)', {
      scopes: ['local', 'international'], countries: ['canada'],
    }),
  source('singapore', 'Singapore job portals', 'regional',
    '(site:mycareersfuture.gov.sg/job OR site:nodeflair.com/jobs OR site:sg.jobstreet.com)', {
      scopes: ['local', 'international'], countries: ['singapore'],
    }),
  source('uae', 'UAE and Gulf job portals', 'regional',
    '(site:naukrigulf.com/jobs OR site:bayt.com/en/uae/jobs OR site:gulftalent.com/uae/jobs)', {
      scopes: ['local', 'international'], countries: ['uae'],
    }),
  source('australia', 'Australia and New Zealand job portals', 'regional',
    '(site:seek.com.au OR site:seek.co.nz OR site:jora.com)', {
      scopes: ['local', 'international'], countries: ['australia', 'new zealand'],
    }),
  source('usa', 'United States job portals', 'regional',
    '(site:dice.com/job-detail OR site:usajobs.gov/job OR site:ziprecruiter.com/jobs OR site:theladders.com/job)', {
      scopes: ['local', 'international'], countries: ['usa'],
    }),
  source('france', 'France job portals', 'regional',
    '(site:welcometothejungle.com/en/companies/jobs OR site:apec.fr/candidat/recherche-emploi.html OR site:fr.indeed.com/viewjob)', {
      scopes: ['local', 'international'], countries: ['france'],
    }),
  source('europe', 'Pan-European job portals', 'international',
    '(site:eures.europa.eu OR site:eurojobs.com OR site:jobsinnetwork.com)', {
      scopes: ['international'], countries: ['europe', 'eu', 'european union'],
    }),
  source('asia-pacific', 'Asia-Pacific job portals', 'international',
    '(site:jobstreet.com OR site:glints.com/opportunities/jobs OR site:jobsdb.com)', {
      scopes: ['international'], countries: ['asia', 'apac', 'southeast asia'],
    }),
]);

export function enabledSources(ids, context = {}) {
  const wanted = Array.isArray(ids) && ids.length
    ? new Set(ids.map((id) => String(id).toLowerCase()))
    : null;
  const stage = inferCareerStage(context);
  const scopes = new Set(context.location?.search_scopes || ['local', 'remote']);
  const home = countryKey(context.location?.home_country);
  const international = new Set(
    (context.location?.international_locations || []).flatMap((value) => countryKeys(value)),
  );
  return SOURCE_REGISTRY.filter((entry) => {
    if (wanted && !wanted.has(entry.id)) return false;
    if (!entry.stages.includes('all') && !entry.stages.includes(stage)) return false;
    if (entry.scopes.includes('all')) return true;
    if (!entry.scopes.some((scope) => scopes.has(scope))) return false;
    if (entry.countries.length === 0) return true;
    const localMatch = scopes.has('local') && entry.countries.includes(home);
    const internationalMatch = scopes.has('international')
      && entry.countries.some((country) => international.has(country));
    return localMatch || internationalMatch;
  });
}

function source(id, name, category, site, options = {}) {
  return Object.freeze({
    id,
    name,
    category,
    site,
    scopes: options.scopes || ['all'],
    countries: options.countries || [],
    stages: options.stages || ['all'],
  });
}

function inferCareerStage(config) {
  const levels = (config.seniority?.preferred_levels || []).join(' ').toLowerCase();
  const max = config.seniority?.maximum_years;
  if (/\b(intern|entry|fresher|graduate|junior)\b/.test(levels) || (max !== null && max <= 3)) return 'early';
  return 'experienced';
}

function countryKeys(value) {
  const normalized = String(value || '').toLowerCase();
  const keys = new Set([countryKey(normalized)]);
  for (const [key, aliases] of Object.entries(COUNTRY_ALIASES)) {
    if (aliases.some((alias) => normalized.includes(alias))) keys.add(key);
  }
  return [...keys].filter(Boolean);
}

function countryKey(value) {
  const normalized = String(value || '').toLowerCase().trim();
  for (const [key, aliases] of Object.entries(COUNTRY_ALIASES)) {
    if (aliases.includes(normalized)) return key;
  }
  return normalized;
}

const COUNTRY_ALIASES = Object.freeze({
  india: ['india', 'ind'],
  germany: ['germany', 'deutschland'],
  uk: ['uk', 'united kingdom', 'great britain', 'england', 'scotland', 'wales'],
  canada: ['canada'],
  singapore: ['singapore'],
  uae: ['uae', 'united arab emirates', 'dubai', 'abu dhabi'],
  australia: ['australia'],
  'new zealand': ['new zealand'],
  usa: ['usa', 'us', 'united states', 'united states of america'],
  france: ['france'],
  europe: ['europe'],
  eu: ['eu', 'european union'],
  asia: ['asia'],
  apac: ['apac', 'asia pacific'],
  'southeast asia': ['southeast asia', 'sea'],
});
