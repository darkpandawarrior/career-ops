const withLevels = (title: string, levels: string[] = ['Junior', 'Senior', 'Lead']) => [title, ...levels.map((level) => `${level} ${title}`)];

export const ROLE_CATALOG = Object.freeze([
  { category: 'Engineering and technology', roles: [
    ...withLevels('Software Engineer'), ...withLevels('Backend Engineer'), ...withLevels('Frontend Engineer'),
    ...withLevels('Full Stack Engineer'), ...withLevels('Mobile Engineer'), 'Android Engineer', 'iOS Engineer',
    'Embedded Systems Engineer', 'Firmware Engineer', 'QA Engineer', 'Test Automation Engineer',
    'DevOps Engineer', 'Platform Engineer', 'Site Reliability Engineer', 'Cloud Engineer',
    'Solutions Architect', 'Security Engineer', 'Network Engineer', 'Systems Administrator',
    'Engineering Manager', 'Director of Engineering', 'VP of Engineering', 'Chief Technology Officer',
  ], aliases: ['Developer', 'Programmer', 'Web Developer', 'Application Developer', 'SRE', 'CTO'] },
  { category: 'Data and AI', roles: [
    ...withLevels('Data Analyst'), ...withLevels('Data Engineer'), ...withLevels('Data Scientist'),
    'Business Intelligence Analyst', 'Analytics Engineer', 'Database Administrator', 'Statistician',
    'Machine Learning Engineer', 'AI Engineer', 'Research Scientist', 'Quantitative Analyst',
    'Data Science Manager', 'Head of Data', 'Chief Data Officer',
  ], aliases: ['BI Analyst', 'MIS Analyst', 'ML Engineer', 'AI Researcher', 'Quant Analyst'] },
  { category: 'Product, program, and project', roles: [
    'Associate Product Manager', ...withLevels('Product Manager', ['Senior', 'Group']), 'Product Owner',
    'Technical Product Manager', 'Product Operations Manager', ...withLevels('Project Manager'),
    'Program Manager', 'Technical Program Manager', 'Scrum Master', 'PMO Analyst', 'Delivery Manager',
    'Business Analyst', 'Systems Analyst', 'Management Consultant', 'Chief of Staff',
    'Director of Product', 'VP of Product', 'Chief Product Officer',
  ], aliases: ['APM', 'TPM', 'Project Coordinator', 'Implementation Manager', 'CPO'] },
  { category: 'Sales and business development', roles: [
    'Sales Development Representative', 'Business Development Representative', 'Inside Sales Representative',
    'Field Sales Representative', ...withLevels('Account Executive', ['Senior', 'Enterprise']),
    'Account Manager', 'Key Account Manager', 'Partnerships Manager', 'Sales Engineer',
    'Solutions Consultant', 'Channel Manager', 'Sales Operations Manager', 'Revenue Operations Manager',
    'Sales Manager', 'Regional Sales Manager', 'Director of Sales', 'VP of Sales', 'Chief Revenue Officer',
  ], aliases: ['SDR', 'BDR', 'Pre-Sales Consultant', 'Relationship Manager', 'CRO'] },
  { category: 'Marketing, communications, and content', roles: [
    'Marketing Coordinator', 'Marketing Manager', 'Product Marketing Manager', 'Brand Manager',
    'Growth Marketing Manager', 'Performance Marketing Manager', 'Digital Marketing Manager',
    'SEO Specialist', 'Content Writer', 'Copywriter', 'Content Strategist', 'Content Marketing Manager',
    'Social Media Manager', 'Community Manager', 'Public Relations Manager', 'Communications Manager',
    'Market Research Analyst', 'Demand Generation Manager', 'Marketing Operations Manager',
    'Director of Marketing', 'VP of Marketing', 'Chief Marketing Officer',
  ], aliases: ['Growth Manager', 'SEO Analyst', 'PR Manager', 'Communications Specialist', 'CMO'] },
  { category: 'Finance, accounting, banking, and insurance', roles: [
    'Accountant', 'Chartered Accountant', 'Staff Accountant', 'Tax Accountant', 'Auditor', 'Internal Auditor',
    'Accounts Payable Specialist', 'Accounts Receivable Specialist', 'Bookkeeper', 'Financial Analyst',
    'FP&A Analyst', 'Finance Manager', 'Financial Controller', 'Treasury Analyst', 'Investment Analyst',
    'Credit Analyst', 'Equity Research Analyst', 'Investment Banker', 'Bank Teller', 'Branch Manager',
    'Loan Officer', 'Mortgage Advisor', 'Insurance Agent', 'Underwriter', 'Actuary', 'Claims Adjuster',
    'Risk Analyst', 'Portfolio Manager', 'Finance Director', 'Chief Financial Officer',
  ], aliases: ['CA', 'CPA', 'FP&A Manager', 'Relationship Banker', 'Claims Examiner', 'CFO'] },
  { category: 'People, HR, and administration', roles: [
    'HR Coordinator', 'HR Generalist', 'HR Business Partner', 'People Operations Manager',
    'Talent Acquisition Specialist', 'Recruiter', 'Technical Recruiter', 'Learning and Development Specialist',
    'Compensation and Benefits Analyst', 'Payroll Specialist', 'Employee Relations Manager',
    'Office Manager', 'Administrative Assistant', 'Executive Assistant', 'Personal Assistant',
    'Receptionist', 'Data Entry Operator', 'HR Director', 'Chief People Officer',
  ], aliases: ['HRBP', 'Talent Sourcer', 'People Partner', 'L&D Specialist', 'CPO People'] },
  { category: 'Operations, supply chain, logistics, and procurement', roles: [
    'Operations Analyst', 'Operations Manager', 'Business Operations Manager', 'Process Improvement Manager',
    'Supply Chain Analyst', 'Supply Chain Manager', 'Logistics Coordinator', 'Logistics Manager',
    'Warehouse Associate', 'Warehouse Manager', 'Inventory Controller', 'Procurement Analyst',
    'Procurement Manager', 'Buyer', 'Category Manager', 'Vendor Manager', 'Fleet Manager',
    'Import Export Coordinator', 'Quality Manager', 'Facilities Manager', 'COO',
  ], aliases: ['Purchasing Manager', 'Sourcing Specialist', 'Dispatch Coordinator', 'Chief Operating Officer'] },
  { category: 'Healthcare and life sciences', roles: [
    'Registered Nurse', 'Nurse Practitioner', 'Physician', 'Medical Officer', 'Pharmacist',
    'Pharmacy Technician', 'Dentist', 'Physiotherapist', 'Occupational Therapist', 'Psychologist',
    'Medical Laboratory Technician', 'Radiologic Technologist', 'Healthcare Administrator',
    'Clinical Research Associate', 'Clinical Research Coordinator', 'Clinical Data Manager',
    'Regulatory Affairs Specialist', 'Medical Writer', 'Epidemiologist', 'Biostatistician',
    'Biomedical Engineer', 'Biotechnologist', 'Microbiologist', 'Quality Assurance Specialist',
  ], aliases: ['RN', 'Doctor', 'Physical Therapist', 'CRA', 'Clinical Trial Manager', 'Lab Technician'] },
  { category: 'Legal, compliance, and risk', roles: [
    'Lawyer', 'Legal Counsel', 'Corporate Counsel', 'Paralegal', 'Legal Assistant', 'Contract Manager',
    'Compliance Analyst', 'Compliance Manager', 'AML Analyst', 'KYC Analyst', 'Fraud Analyst',
    'Risk Manager', 'Operational Risk Analyst', 'Information Security Compliance Analyst',
    'Privacy Officer', 'Data Protection Officer', 'Company Secretary', 'General Counsel',
  ], aliases: ['Attorney', 'Solicitor', 'Advocate', 'Contracts Specialist', 'DPO', 'MLRO'] },
  { category: 'Education and research', roles: [
    'Teacher', 'Primary School Teacher', 'Secondary School Teacher', 'Special Education Teacher',
    'Lecturer', 'Professor', 'Teaching Assistant', 'Tutor', 'Instructional Designer',
    'Curriculum Developer', 'Academic Advisor', 'School Counselor', 'School Administrator',
    'Principal', 'Research Assistant', 'Research Associate', 'Postdoctoral Researcher',
    'Education Program Manager', 'Librarian',
  ], aliases: ['Educator', 'Faculty Member', 'Trainer', 'Postdoc', 'Curriculum Designer'] },
  { category: 'Design, creative, and media', roles: [
    'Graphic Designer', 'Product Designer', 'UX Designer', 'UI Designer', 'UX Researcher',
    'Interaction Designer', 'Service Designer', 'Industrial Designer', 'Illustrator', 'Animator',
    'Motion Graphics Designer', 'Video Editor', 'Photographer', 'Art Director', 'Creative Director',
    'Journalist', 'Editor', 'Producer', 'Sound Engineer', 'Content Designer',
  ], aliases: ['UI/UX Designer', 'Visual Designer', 'Motion Designer', 'Videographer', 'Reporter'] },
  { category: 'Construction, manufacturing, and skilled trades', roles: [
    'Civil Engineer', 'Mechanical Engineer', 'Electrical Engineer', 'Chemical Engineer',
    'Structural Engineer', 'Construction Manager', 'Site Engineer', 'Quantity Surveyor', 'Architect',
    'Manufacturing Engineer', 'Production Engineer', 'Plant Manager', 'Production Supervisor',
    'Maintenance Technician', 'Electrician', 'Plumber', 'Carpenter', 'Welder', 'Machinist',
    'HVAC Technician', 'Automotive Technician', 'Safety Officer', 'Quality Inspector',
  ], aliases: ['Site Manager', 'Estimator', 'CAD Technician', 'Fitter', 'Mechanic', 'HSE Officer'] },
  { category: 'Hospitality, travel, retail, and customer service', roles: [
    'Customer Service Representative', 'Customer Support Specialist', 'Technical Support Specialist',
    'Customer Success Manager', 'Call Center Representative', 'Retail Sales Associate', 'Store Manager',
    'Merchandiser', 'Cashier', 'Hotel Manager', 'Front Desk Agent', 'Concierge', 'Housekeeping Supervisor',
    'Chef', 'Cook', 'Restaurant Manager', 'Food and Beverage Manager', 'Travel Consultant',
    'Tour Guide', 'Flight Attendant', 'Event Coordinator', 'Event Manager',
  ], aliases: ['CSR', 'Support Engineer', 'Guest Relations Executive', 'Travel Agent', 'Cabin Crew'] },
  { category: 'Government, nonprofit, and public service', roles: [
    'Civil Servant', 'Policy Analyst', 'Public Affairs Specialist', 'Government Relations Manager',
    'Program Officer', 'Program Coordinator', 'Nonprofit Program Manager', 'Fundraising Manager',
    'Grant Writer', 'Monitoring and Evaluation Specialist', 'Community Outreach Coordinator',
    'Social Worker', 'Case Manager', 'Urban Planner', 'Environmental Officer', 'Public Health Officer',
    'Police Officer', 'Firefighter', 'Emergency Management Specialist',
  ], aliases: ['Public Administrator', 'Development Officer', 'M&E Specialist', 'NGO Program Manager'] },
]);

export const ROLE_OPTIONS = Object.freeze([...new Set(ROLE_CATALOG.flatMap(({ roles, aliases }) => [...roles, ...aliases]))].sort((a, b) => a.localeCompare(b)));

export const BASE_OPTION_CATALOG = Object.freeze({
  skills: [
    'Accounting', 'Account Management', 'A/B Testing', 'Accessibility', 'Adobe Creative Suite', 'Agriculture', 'Airlines', 'Analytics', 'Animal Care', 'Automotive Repair',
    'Agile', 'Android', 'Angular', 'API Design', 'AWS', 'Azure', 'B2B Sales', 'Budgeting',
    'Business Analysis', 'C', 'C++', 'Campaign Management', 'Cash Management', 'Change Management', 'Childcare', 'CI/CD',
    'Clinical Operations', 'Cloud Architecture', 'Coaching', 'Commercial Awareness', 'Compliance', 'Content Strategy',
    'Copywriting', 'CRM', 'Customer Discovery', 'Customer Service', 'Customer Success', 'Cybersecurity', 'Data Analysis',
    'Data Engineering', 'Data Visualization', 'DevOps', 'Document Control', 'Docker', 'ETL', 'Excel', 'Facilities Management', 'Figma',
    'Financial Modeling', 'Fleet Management', 'Flutter', 'Forecasting', 'GCP', 'Go', 'GraphQL', 'HR Operations',
    'Incident Management', 'Insurance', 'Java', 'JavaScript', 'Jetpack Compose', 'Kafka', 'Kotlin',
    'Kubernetes', 'Lead Generation', 'Logistics', 'Machine Learning', 'Market Research', 'Marketing Automation',
    'Node.js', 'Negotiation', 'OKRs', 'Operations Management', 'Performance Marketing', 'PostgreSQL',
    'Product Analytics', 'Product Management', 'Project Management', 'Procurement', 'Project Coordination', 'Python', 'React',
    'Recruiting', 'Renewable Energy', 'Risk Management', 'Ruby', 'Salesforce', 'SEO', 'SQL', 'Spring Boot',
    'Stakeholder Management', 'Strategic Planning', 'Swift', 'Supply Chain', 'Tableau', 'Terraform', 'TypeScript',
    'UI Design', 'Unit Testing', 'User Research', 'Warehouse Operations', 'Vendor Management',
  ],
  roles: ROLE_OPTIONS,
  locations: [
    'Ahmedabad', 'Amsterdam', 'Australia', 'Bangalore', 'Berlin', 'Brazil', 'Canada', 'Chennai',
    'Delhi NCR', 'Dubai', 'France', 'Germany', 'Gurgaon', 'Hyderabad', 'India', 'Ireland',
    'Japan', 'London', 'Mexico', 'Mumbai', 'Netherlands', 'New York', 'Noida', 'Pune',
    'Remote', 'San Francisco', 'Singapore', 'Spain', 'Toronto', 'United Arab Emirates',
    'United Kingdom', 'United States',
  ],
  countries: [
    'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Antigua and Barbuda', 'Argentina',
    'Armenia', 'Australia', 'Austria', 'Azerbaijan', 'Bahamas', 'Bahrain', 'Bangladesh',
    'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin', 'Bhutan', 'Bolivia',
    'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei', 'Bulgaria', 'Burkina Faso',
    'Burundi', 'Cabo Verde', 'Cambodia', 'Cameroon', 'Canada', 'Central African Republic',
    'Chad', 'Chile', 'China', 'Colombia', 'Comoros', 'Congo', 'Costa Rica', 'Croatia',
    'Cuba', 'Cyprus', 'Czechia', 'Democratic Republic of the Congo', 'Denmark', 'Djibouti',
    'Dominica', 'Dominican Republic', 'Ecuador', 'Egypt', 'El Salvador', 'Equatorial Guinea',
    'Eritrea', 'Estonia', 'Eswatini', 'Ethiopia', 'Fiji', 'Finland', 'France', 'Gabon',
    'Gambia', 'Georgia', 'Germany', 'Ghana', 'Greece', 'Grenada', 'Guatemala', 'Guinea',
    'Guinea-Bissau', 'Guyana', 'Haiti', 'Honduras', 'Hungary', 'Iceland', 'India',
    'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Israel', 'Italy', 'Ivory Coast', 'Jamaica',
    'Japan', 'Jordan', 'Kazakhstan', 'Kenya', 'Kiribati', 'Kosovo', 'Kuwait', 'Kyrgyzstan',
    'Laos', 'Latvia', 'Lebanon', 'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania',
    'Luxembourg', 'Madagascar', 'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta',
    'Marshall Islands', 'Mauritania', 'Mauritius', 'Mexico', 'Micronesia', 'Moldova', 'Monaco',
    'Mongolia', 'Montenegro', 'Morocco', 'Mozambique', 'Myanmar', 'Namibia', 'Nauru', 'Nepal',
    'Netherlands', 'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'North Korea',
    'North Macedonia', 'Norway', 'Oman', 'Pakistan', 'Palau', 'Palestine', 'Panama',
    'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Poland', 'Portugal', 'Qatar',
    'Romania', 'Russia', 'Rwanda', 'Saint Kitts and Nevis', 'Saint Lucia',
    'Saint Vincent and the Grenadines', 'Samoa', 'San Marino', 'Sao Tome and Principe',
    'Saudi Arabia', 'Senegal', 'Serbia', 'Seychelles', 'Sierra Leone', 'Singapore',
    'Slovakia', 'Slovenia', 'Solomon Islands', 'Somalia', 'South Africa', 'South Korea',
    'South Sudan', 'Spain', 'Sri Lanka', 'Sudan', 'Suriname', 'Sweden', 'Switzerland',
    'Syria', 'Taiwan', 'Tajikistan', 'Tanzania', 'Thailand', 'Timor-Leste', 'Togo', 'Tonga',
    'Trinidad and Tobago', 'Tunisia', 'Turkey', 'Turkmenistan', 'Tuvalu', 'Uganda', 'Ukraine',
    'United Arab Emirates', 'United Kingdom', 'United States', 'Uruguay', 'Uzbekistan',
    'Vanuatu', 'Vatican City', 'Venezuela', 'Vietnam', 'Yemen', 'Zambia', 'Zimbabwe',
  ],
  regions: [
    'Worldwide', 'Global', 'Americas', 'North America', 'Latin America', 'Europe',
    'European Union', 'Middle East', 'Africa', 'EMEA', 'APAC', 'Asia-Pacific',
    'South Asia', 'Southeast Asia', 'India', 'US time zones', 'Canada', 'UK and Ireland',
  ],
  industries: [
    'AI', 'B2B SaaS', 'Banking', 'Climate', 'Consulting', 'Consumer Apps', 'Developer Tools',
    'E-commerce', 'Education', 'Enterprise Software', 'Fintech', 'Gaming', 'Government',
    'Healthcare', 'Insurance', 'Logistics', 'Manufacturing', 'Media', 'Nonprofit',
    'Agriculture', 'Aerospace', 'Automotive', 'Construction', 'Consumer Goods', 'Energy', 'Hospitality', 'Legal Services', 'Pharmaceuticals', 'Public Sector', 'Real Estate', 'Retail', 'Security', 'Telecom', 'Travel',
  ],
  noticePeriods: ['Immediate', '1 week', '2 weeks', '30 days', '45 days', '60 days', '90 days', 'Other'],
});

export const SKILL_CATALOG = BASE_OPTION_CATALOG.skills;
export const INDUSTRY_CATALOG = BASE_OPTION_CATALOG.industries;
export const COUNTRY_CATALOG = BASE_OPTION_CATALOG.countries;
export const REGION_CATALOG = BASE_OPTION_CATALOG.regions;

const categoryToIndustries: Record<string, string[]> = {
  'Engineering and technology': ['AI', 'Developer Tools', 'Enterprise Software', 'Security', 'Telecom', 'B2B SaaS'],
  'Data and AI': ['AI', 'Banking', 'Consulting', 'Fintech', 'Healthcare', 'Enterprise Software', 'Government'],
  'Product, program, and project': ['B2B SaaS', 'Consumer Apps', 'Enterprise Software', 'E-commerce', 'Education'],
  'Sales and business development': ['B2B SaaS', 'Enterprise Software', 'E-commerce', 'Fintech', 'Telecom'],
  'Marketing, communications, and content': ['B2B SaaS', 'Consumer Apps', 'E-commerce', 'Media', 'Retail'],
  'Finance, accounting, banking, and insurance': ['Banking', 'Fintech', 'Insurance', 'Consulting', 'Government'],
  'People, HR, and administration': ['Consulting', 'Enterprise Software', 'Government', 'Healthcare', 'Nonprofit'],
  'Operations, supply chain, logistics, and procurement': ['Logistics', 'Manufacturing', 'Retail', 'E-commerce'],
  'Healthcare and life sciences': ['Healthcare'],
  'Legal, compliance, and risk': ['Banking', 'Fintech', 'Insurance', 'Government', 'Security'],
  'Education and research': ['Education', 'Government', 'Nonprofit'],
  'Design, creative, and media': ['Consumer Apps', 'Media', 'E-commerce', 'Gaming', 'B2B SaaS'],
  'Construction, manufacturing, and skilled trades': ['Manufacturing', 'Government', 'Logistics'],
  'Hospitality, travel, retail, and customer service': ['Retail', 'Travel', 'E-commerce', 'Consumer Apps'],
  'Government, nonprofit, and public service': ['Government', 'Nonprofit'],
};

const categorySkillHints: Record<string, string[]> = {
  'Engineering and technology': ['Android', 'AWS', 'CI/CD', 'Docker', 'Kubernetes', 'Java', 'JavaScript', 'Node.js', 'PostgreSQL', 'React', 'Swift', 'TypeScript'],
  'Data and AI': ['Data Analysis', 'Data Engineering', 'Machine Learning', 'Python', 'SQL', 'Tableau'],
  'Product, program, and project': ['Business Analysis', 'Product Management', 'Project Management', 'Stakeholder Management', 'Strategic Planning', 'OKRs'],
  'Sales and business development': ['Account Management', 'B2B Sales', 'CRM', 'Customer Discovery', 'Lead Generation', 'Salesforce'],
  'Marketing, communications, and content': ['A/B Testing', 'Campaign Management', 'Content Strategy', 'Copywriting', 'Marketing Automation', 'Performance Marketing', 'SEO'],
  'Finance, accounting, banking, and insurance': ['Accounting', 'Budgeting', 'Financial Modeling', 'Forecasting', 'Risk Management'],
  'People, HR, and administration': ['Coaching', 'HR Operations', 'Recruiting', 'Vendor Management'],
  'Operations, supply chain, logistics, and procurement': ['Operations Management', 'Vendor Management'],
  'Healthcare and life sciences': ['Clinical Operations', 'Compliance', 'Data Analysis'],
  'Legal, compliance, and risk': ['Compliance', 'Cybersecurity', 'Risk Management'],
  'Education and research': ['Curriculum Development', 'Research', 'User Research'],
  'Design, creative, and media': ['Adobe Creative Suite', 'Figma', 'UI Design', 'User Research'],
  'Construction, manufacturing, and skilled trades': ['Safety', 'Quality Assurance'],
  'Hospitality, travel, retail, and customer service': ['Customer Success', 'Customer Service', 'Operations Management'],
  'Government, nonprofit, and public service': ['Community Outreach', 'Grant Writing', 'Program Management'],
};

function uniqSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export function rolesForIndustries(selectedIndustries: string[]): readonly string[] {
  const inds = selectedIndustries.map((s) => s.trim()).filter(Boolean);
  if (!inds.length) return ROLE_OPTIONS;
  const categories = ROLE_CATALOG.filter(({ category }) => (categoryToIndustries[category] || []).some((ind) => inds.includes(ind)));
  const roles = categories.flatMap(({ roles, aliases }) => [...roles, ...aliases]);
  return roles.length ? uniqSorted(roles) : ROLE_OPTIONS;
}

export function skillsForRoles(selectedRoles: string[], selectedIndustries: string[] = []): readonly string[] {
  const roles = selectedRoles.map((s) => s.trim()).filter(Boolean).map((s) => s.toLowerCase());
  const industries = selectedIndustries.map((s) => s.trim()).filter(Boolean);
  const hints = new Set<string>();
  for (const role of roles) {
    if (/android|mobile|ios|react native/.test(role)) (['Android', 'Flutter', 'Kotlin', 'Swift', 'Jetpack Compose'] as const).forEach((x) => hints.add(x));
    if (/data|analyst|science|ml|ai/.test(role)) (['Data Analysis', 'Data Engineering', 'Machine Learning', 'Python', 'SQL', 'Tableau'] as const).forEach((x) => hints.add(x));
    if (/product|project|program|scrum|business analyst|tpm/.test(role)) (['Business Analysis', 'Product Management', 'Project Management', 'Stakeholder Management', 'OKRs'] as const).forEach((x) => hints.add(x));
    if (/sales|account|business development|customer success/.test(role)) (['Account Management', 'B2B Sales', 'CRM', 'Customer Discovery', 'Lead Generation', 'Salesforce'] as const).forEach((x) => hints.add(x));
    if (/marketing|content|seo|growth/.test(role)) (['A/B Testing', 'Campaign Management', 'Content Strategy', 'Copywriting', 'Marketing Automation', 'Performance Marketing', 'SEO'] as const).forEach((x) => hints.add(x));
    if (/finance|accountant|audit|bank|insurance|risk/.test(role)) (['Accounting', 'Budgeting', 'Financial Modeling', 'Forecasting', 'Risk Management'] as const).forEach((x) => hints.add(x));
    if (/hr|recruit|people|talent/.test(role)) (['Coaching', 'HR Operations', 'Recruiting', 'Vendor Management'] as const).forEach((x) => hints.add(x));
    if (/operations|supply chain|logistics|procurement/.test(role)) (['Operations Management', 'Vendor Management'] as const).forEach((x) => hints.add(x));
    if (/health|clinical|nurse|pharmac|biostat|medical/.test(role)) (['Clinical Operations', 'Compliance', 'Data Analysis'] as const).forEach((x) => hints.add(x));
    if (/legal|compliance|risk|privacy/.test(role)) (['Compliance', 'Cybersecurity', 'Risk Management'] as const).forEach((x) => hints.add(x));
    if (/teacher|lecturer|professor|instructional|research/.test(role)) (['Curriculum Development', 'Research', 'User Research'] as const).forEach((x) => hints.add(x));
    if (/design|ux|ui|creative|media/.test(role)) (['Adobe Creative Suite', 'Figma', 'UI Design', 'User Research'] as const).forEach((x) => hints.add(x));
    if (/engineer|developer|devops|sre|platform|qa|software/.test(role)) (['Android', 'AWS', 'CI/CD', 'Docker', 'Kubernetes', 'Java', 'JavaScript', 'Node.js', 'PostgreSQL', 'React', 'Swift', 'TypeScript'] as const).forEach((x) => hints.add(x));
  }
  for (const ind of industries) {
    const category = ROLE_CATALOG.find(({ category }) => (categoryToIndustries[category] || []).includes(ind))?.category;
    if (category) categorySkillHints[category]?.forEach((x) => hints.add(x));
  }
  const base = [...BASE_OPTION_CATALOG.skills, ...hints];
  return uniqSorted(base);
}



