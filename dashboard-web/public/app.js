const state = {
  payload: null,
  jobs: [],
  filterText: '',
  minScore: 0,
  draft: null,
  inference: null,
  reviewStep: 0,
};

const ids = [
  'refreshBtn', 'changeProfileBtn', 'profileLine', 'onboardingPanel', 'returningPanel',
  'uploadPanel', 'dashboardPanel', 'returningName', 'returningHeadline',
  'returningLocation', 'returningRoles', 'continueBtn', 'newProfileBtn',
  'backToProfileBtn', 'uploadForm', 'dropZone', 'resumeInput', 'selectedFile',
  'uploadBtn', 'uploadStatus', 'draftPanel', 'draftFilename', 'draftDetails',
  'extractBtn', 'discardDraftBtn', 'extractionPanel', 'extractionStats',
  'extractionWarnings', 'extractionSections', 'extractionPreview', 'reviewBtn',
  'reviewPanel', 'backToExtractionBtn', 'reviewProgress', 'reviewForm',
  'reviewName', 'reviewEmail', 'reviewPhone', 'reviewLocation', 'reviewLinkedin',
  'reviewGithub', 'reviewPortfolio', 'personalEvidence', 'reviewYears',
  'reviewSeniority', 'reviewNoticePeriod', 'reviewSummary', 'experienceEvidence', 'reviewSkillsDemonstrated',
  'reviewSkillsConfirmed', 'reviewSkillsSupporting', 'reviewSkillsLearning',
  'reviewSkillsExcluded', 'skillsEvidence', 'reviewTargetRoles', 'reviewAdjacentRoles',
  'reviewExcludedTitles', 'reviewIndustries', 'rolesEvidence', 'reviewHomeCountry', 'reviewRelocation',
  'reviewScopeLocal', 'reviewScopeRemote', 'reviewScopeInternational',
  'reviewPreferredLocations', 'reviewRemoteRegions', 'reviewInternationalLocations',
  'internationalLocationsLabel', 'reviewRemoteEligibility',
  'reviewVisaRequired', 'reviewCurrency', 'reviewMinimumAnnual', 'reviewTargetAnnual',
  'reviewErrors', 'reviewStepErrors', 'reviewPreview', 'reviewPrevBtn', 'reviewNextBtn', 'validateReviewBtn',
  'activationPreview', 'activationConfirm', 'activationProgress', 'activateProfileBtn',
  'totalCount', 'excellentCount', 'sourceCount',
  'searchInput', 'scoreFilter', 'statusLine', 'recommendedCount', 'reviewCount',
  'sourceSectionCount', 'recommendedJobs', 'reviewJobs', 'sourceJobs',
  'actionDialog', 'dialogTitle', 'dialogBody',
];
const els = Object.fromEntries(ids.map((id) => [id, document.querySelector(`#${id}`)]));

els.refreshBtn.addEventListener('click', () => loadDashboard(true));
els.changeProfileBtn.addEventListener('click', showReturningProfile);
els.continueBtn.addEventListener('click', showDashboard);
els.newProfileBtn.addEventListener('click', showUpload);
els.backToProfileBtn.addEventListener('click', showReturningProfile);
els.resumeInput.addEventListener('change', () => selectFiles(els.resumeInput.files));
els.uploadForm.addEventListener('submit', uploadResume);
els.discardDraftBtn.addEventListener('click', discardDraft);
els.extractBtn.addEventListener('click', extractResume);
els.reviewBtn.addEventListener('click', startReview);
els.backToExtractionBtn.addEventListener('click', () => showView('upload'));
els.reviewPrevBtn.addEventListener('click', () => setReviewStep(state.reviewStep - 1));
els.reviewNextBtn.addEventListener('click', () => {
  if (validateReviewStep(state.reviewStep)) setReviewStep(state.reviewStep + 1);
});
els.reviewForm.addEventListener('submit', validateReview);
els.activationConfirm.addEventListener('change', () => {
  els.activateProfileBtn.disabled = !els.activationConfirm.checked;
});
for (const scope of [els.reviewScopeLocal, els.reviewScopeRemote, els.reviewScopeInternational]) {
  scope.addEventListener('change', updateScopeFields);
}
els.activateProfileBtn.addEventListener('click', activateProfile);
els.searchInput.addEventListener('input', (event) => {
  state.filterText = event.target.value.toLowerCase();
  renderJobs();
});
els.scoreFilter.addEventListener('change', (event) => {
  state.minScore = Number(event.target.value);
  renderJobs();
});
for (const eventName of ['dragenter', 'dragover']) {
  els.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.dropZone.classList.add('dragging');
  });
}
for (const eventName of ['dragleave', 'drop']) {
  els.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.dropZone.classList.remove('dragging');
  });
}
els.dropZone.addEventListener('drop', (event) => {
  if (event.dataTransfer?.files?.length) {
    els.resumeInput.files = event.dataTransfer.files;
    selectFiles(event.dataTransfer.files);
  }
});

await initialize();

async function initialize() {
  state.payload = await request('/api/jobs');
  state.jobs = state.payload.jobs || [];
  renderHeader();
  renderSummary(state.payload);
  renderJobs();
  const draftId = new URLSearchParams(location.search).get('draft');
  if (draftId) {
    try {
      const draftPayload = await request(`/api/setup/draft?id=${encodeURIComponent(draftId)}`);
      state.draft = draftPayload.draft;
      showUpload();
      renderDraft();
      if (draftPayload.extraction) renderExtraction(draftPayload.extraction);
      if (draftPayload.inference) state.inference = draftPayload.inference;
      return;
    } catch {
      history.replaceState({}, '', location.pathname);
    }
  }
  if (state.payload.setup?.hasActiveProfile) showReturningProfile();
  else showUpload();
}

async function loadDashboard(force) {
  setDashboardBusy(true);
  try {
    state.payload = await request(force ? '/api/refresh' : '/api/jobs', {
      method: force ? 'POST' : 'GET',
    });
    state.jobs = state.payload.jobs || [];
    renderHeader();
    renderSummary(state.payload);
    renderJobs();
    els.statusLine.textContent = state.payload.diagnostics?.note || 'Dashboard ready.';
  } catch (error) {
    els.statusLine.textContent = `Dashboard failed: ${error.message}`;
  } finally {
    setDashboardBusy(false);
  }
}

function showReturningProfile() {
  const profile = state.payload?.profile || {};
  els.returningName.textContent = profile.name || 'Candidate';
  els.returningHeadline.textContent = profile.headline || 'No headline configured';
  els.returningLocation.textContent = profile.location || 'Location not configured';
  els.returningRoles.textContent = (profile.roles || []).join(' · ') || 'Target roles not configured';
  els.backToProfileBtn.hidden = true;
  showView('returning');
}

function showUpload() {
  els.backToProfileBtn.hidden = !state.payload?.setup?.hasActiveProfile;
  showView('upload');
}

function showDashboard() {
  showView('dashboard');
  els.statusLine.textContent = state.payload?.diagnostics?.note || 'Dashboard ready.';
}

function showView(view) {
  els.onboardingPanel.hidden = view === 'dashboard';
  els.returningPanel.hidden = view !== 'returning';
  els.uploadPanel.hidden = view !== 'upload';
  els.reviewPanel.hidden = view !== 'review';
  els.dashboardPanel.hidden = view !== 'dashboard';
  els.changeProfileBtn.hidden = view !== 'dashboard' || !state.payload?.setup?.hasActiveProfile;
  els.refreshBtn.hidden = view !== 'dashboard';
  els.profileLine.hidden = view !== 'dashboard';
}

function renderHeader() {
  const profile = state.payload?.profile;
  els.profileLine.textContent = profile
    ? [profile.name, profile.headline, profile.location].filter(Boolean).join(' · ')
    : 'No active profile yet';
}

function selectFiles(files) {
  const file = files?.[0];
  els.selectedFile.textContent = file
    ? `${file.name} · ${formatBytes(file.size)}`
    : 'No file selected';
  setUploadStatus('', false);
}

async function uploadResume(event) {
  event.preventDefault();
  const file = els.resumeInput.files?.[0];
  if (!file) {
    setUploadStatus('Choose a resume before uploading.', true);
    return;
  }
  setUploadBusy(true);
  setUploadStatus('Staging resume locally…', false);
  try {
    const body = new FormData();
    body.append('resume', file, file.name);
    const payload = await request('/api/setup/upload', { method: 'POST', body }, false);
    state.draft = payload.draft;
    history.replaceState({}, '', `?draft=${encodeURIComponent(state.draft.draftId)}`);
    renderDraft();
    els.extractionPanel.hidden = true;
    els.reviewPanel.hidden = true;
    setUploadStatus('Resume staged. Your active profile has not changed.', false);
  } catch (error) {
    setUploadStatus(error.message, true);
  } finally {
    setUploadBusy(false);
  }
}

async function discardDraft() {
  if (!state.draft) return;
  els.discardDraftBtn.disabled = true;
  try {
    await request('/api/setup/reset', {
      method: 'POST',
      body: JSON.stringify({ draftId: state.draft.draftId }),
    });
    state.draft = null;
    history.replaceState({}, '', location.pathname);
    els.draftPanel.hidden = true;
    els.extractionPanel.hidden = true;
    els.uploadForm.reset();
    selectFiles(null);
    setUploadStatus('The staged upload was removed.', false);
  } finally {
    els.discardDraftBtn.disabled = false;
  }
}

function renderDraft() {
  const draft = state.draft;
  els.draftFilename.textContent = draft.filename;
  els.draftDetails.textContent = `${draft.extension.toUpperCase().slice(1)} · ${formatBytes(draft.size)} · stored locally`;
  els.draftPanel.hidden = false;
}

async function extractResume() {
  if (!state.draft) return;
  els.extractBtn.disabled = true;
  els.extractBtn.textContent = 'Extracting…';
  setUploadStatus('Extracting resume text locally…', false);
  try {
    const payload = await request('/api/setup/extract', {
      method: 'POST',
      body: JSON.stringify({ draftId: state.draft.draftId }),
    });
    state.draft = payload.draft;
    renderExtraction(payload.extraction);
    setUploadStatus('Extraction complete. Review the detected sections below.', false);
  } catch (error) {
    setUploadStatus(error.message, true);
  } finally {
    els.extractBtn.disabled = false;
    els.extractBtn.textContent = 'Extract resume';
  }
}

function renderExtraction(extraction) {
  const diagnostics = extraction.diagnostics || {};
  const pageText = extraction.pages ? ` · ${extraction.pages} page${extraction.pages === 1 ? '' : 's'}` : '';
  els.extractionStats.textContent = `${diagnostics.wordCount || 0} words${pageText}`;
  els.extractionWarnings.hidden = !(extraction.warnings || []).length;
  els.extractionWarnings.textContent = (extraction.warnings || []).join(' ');
  els.extractionSections.textContent = '';
  for (const section of extraction.sections || []) {
    const card = document.createElement('article');
    card.className = 'extraction-section';
    const heading = document.createElement('h4');
    heading.textContent = section.title;
    const meta = document.createElement('span');
    meta.textContent = `${section.lineCount} line${section.lineCount === 1 ? '' : 's'}`;
    const preview = document.createElement('p');
    preview.textContent = section.preview || 'No text detected';
    card.append(heading, meta, preview);
    els.extractionSections.append(card);
  }
  els.extractionPreview.textContent = extraction.preview || '';
  els.extractionPanel.hidden = false;
}

async function startReview() {
  if (!state.draft) return;
  els.reviewBtn.disabled = true;
  els.reviewBtn.textContent = 'Preparing review…';
  try {
    if (!state.inference) {
      const payload = await request('/api/setup/infer', {
        method: 'POST',
        body: JSON.stringify({ draftId: state.draft.draftId }),
      });
      state.inference = payload.inference;
    }
    populateReview(state.inference);
    state.reviewStep = 0;
    setReviewStep(0);
    showView('review');
  } catch (error) {
    setUploadStatus(error.message, true);
  } finally {
    els.reviewBtn.disabled = false;
    els.reviewBtn.textContent = 'Continue to profile review';
  }
}

function populateReview(inference) {
  const candidate = inference.candidate || {};
  els.reviewName.value = candidate.full_name?.value || '';
  els.reviewEmail.value = candidate.email?.value || '';
  els.reviewPhone.value = candidate.phone?.value || '';
  els.reviewLocation.value = candidate.location?.value || '';
  els.reviewLinkedin.value = candidate.linkedin?.value || '';
  els.reviewGithub.value = candidate.github?.value || '';
  els.reviewPortfolio.value = candidate.portfolio_url?.value || '';
  els.reviewSummary.value = inference.summary?.value || '';
  els.reviewYears.value = inference.experience?.total_years?.value ?? '';
  els.reviewSeniority.value = inference.seniority?.value || '';
  els.reviewNoticePeriod.value = inference.availability?.notice_period || '';
  const demonstrated = inference.skills?.filter((skill) => skill.suggested_state === 'demonstrated') || [];
  const supporting = inference.skills?.filter((skill) => skill.suggested_state === 'supporting') || [];
  els.reviewSkillsDemonstrated.value = demonstrated.map((skill) => skill.name).join(', ');
  els.reviewSkillsSupporting.value = supporting.map((skill) => skill.name).join(', ');
  els.reviewSkillsConfirmed.value = '';
  els.reviewSkillsLearning.value = '';
  els.reviewSkillsExcluded.value = '';
  const primary = inference.target_roles?.filter((role) => role.suggested_fit === 'primary') || [];
  const adjacent = inference.target_roles?.filter((role) => role.suggested_fit === 'adjacent') || [];
  els.reviewTargetRoles.value = primary.map((role) => role.name).join(', ');
  els.reviewAdjacentRoles.value = adjacent.map((role) => role.name).join(', ');
  els.reviewExcludedTitles.value = '';
  els.reviewIndustries.value = '';
  els.reviewHomeCountry.value = inferCountry(candidate.location?.value || '');
  els.reviewPreferredLocations.value = candidate.location?.value || '';
  els.reviewRemoteRegions.value = '';
  els.reviewInternationalLocations.value = '';
  els.reviewRelocation.value = '';
  els.reviewScopeLocal.checked = false;
  els.reviewScopeRemote.checked = false;
  els.reviewScopeInternational.checked = false;
  els.reviewRemoteEligibility.checked = true;
  els.reviewVisaRequired.checked = false;
  updateScopeFields();
  els.reviewCurrency.value = '';
  els.reviewMinimumAnnual.value = '';
  els.reviewTargetAnnual.value = '';

  els.personalEvidence.textContent = [
    evidenceText('Name', candidate.full_name),
    evidenceText('Email', candidate.email),
    evidenceText('Location', candidate.location),
  ].filter(Boolean).join(' · ');
  els.experienceEvidence.textContent = [
    evidenceText('Experience', inference.experience?.total_years),
    evidenceText('Seniority', inference.seniority),
  ].filter(Boolean).join(' · ');
  renderEvidenceList(els.skillsEvidence, inference.skills || [], (item) =>
    `${item.name} · ${percent(item.confidence)} · ${item.source}`
  );
  renderEvidenceList(els.rolesEvidence, inference.target_roles || [], (item) =>
    `${item.name} · ${percent(item.confidence)} · ${item.source}`
  );
}

function updateScopeFields() {
  els.reviewRemoteRegions.disabled = !els.reviewScopeRemote.checked;
  els.reviewRemoteEligibility.disabled = !els.reviewScopeRemote.checked;
  if (!els.reviewScopeRemote.checked) els.reviewRemoteEligibility.checked = false;
  els.reviewInternationalLocations.disabled = !els.reviewScopeInternational.checked;
  els.internationalLocationsLabel.hidden = !els.reviewScopeInternational.checked;
}

function setReviewStep(step) {
  const steps = [...document.querySelectorAll('.review-step')];
  state.reviewStep = Math.max(0, Math.min(steps.length - 1, step));
  steps.forEach((section, index) => { section.hidden = index !== state.reviewStep; });
  els.reviewProgress.textContent = `Step ${state.reviewStep + 1} of ${steps.length}`;
  els.reviewPrevBtn.hidden = state.reviewStep === 0;
  els.reviewNextBtn.hidden = state.reviewStep === steps.length - 1;
  els.validateReviewBtn.hidden = state.reviewStep !== steps.length - 1;
  els.activateProfileBtn.hidden = true;
  els.activationConfirm.checked = false;
  els.activationPreview.hidden = true;
  els.reviewStepErrors.hidden = true;
  if (state.reviewStep === steps.length - 1) {
    els.reviewPreview.textContent = JSON.stringify(collectReview(), null, 2);
  }
}

function validateReviewStep(step) {
  const messages = [];
  if (step === 0 && !els.reviewName.value.trim()) messages.push('Full name is required.');
  if (step === 1) {
    if (els.reviewYears.value === '') messages.push('Enter years of experience. Use 0 if there is no employment experience.');
    if (!els.reviewSeniority.value) messages.push('Choose an experience level.');
    if (!els.reviewNoticePeriod.value.trim()) messages.push('Enter the notice period.');
  }
  if (step === 2 && csv(els.reviewSkillsDemonstrated.value).length < 5) {
    messages.push('Confirm at least five demonstrated skills.');
  }
  if (step === 3 && csv(els.reviewTargetRoles.value).length === 0) {
    messages.push('Add at least one primary target role.');
  }
  if (step === 4) {
    if (!els.reviewHomeCountry.value.trim()) messages.push('Home country is required.');
    if (!els.reviewRelocation.value) messages.push('Choose a relocation preference.');
    if (selectedSearchScopes().length === 0) {
      messages.push('Choose at least one search scope: local, remote, or international.');
    }
    if (els.reviewScopeInternational.checked && csv(els.reviewInternationalLocations.value).length === 0) {
      messages.push('Add at least one target country or region for international search.');
    }
  }
  els.reviewStepErrors.textContent = messages.join(' ');
  els.reviewStepErrors.hidden = messages.length === 0;
  return messages.length === 0;
}

async function validateReview(event) {
  event.preventDefault();
  const review = collectReview();
  els.validateReviewBtn.disabled = true;
  els.reviewErrors.hidden = true;
  try {
    const payload = await request('/api/setup/preview', {
      method: 'POST',
      body: JSON.stringify({ draftId: state.draft.draftId, review }),
    });
    els.reviewPreview.textContent = JSON.stringify(payload.review, null, 2);
    const activation = await request('/api/setup/activation-preview', {
      method: 'POST',
      body: JSON.stringify({ draftId: state.draft.draftId }),
    });
    renderActivationPreview(activation);
    els.activateProfileBtn.hidden = false;
    els.activateProfileBtn.disabled = !els.activationConfirm.checked;
  } catch (error) {
    const errors = error.payload?.errors || [error.message];
    els.reviewErrors.textContent = errors.join(' ');
    els.reviewErrors.hidden = false;
  } finally {
    els.validateReviewBtn.disabled = false;
  }
}

async function activateProfile() {
  if (!state.draft || !els.activationConfirm.checked) return;
  els.activateProfileBtn.disabled = true;
  els.activateProfileBtn.textContent = 'Activating…';
  els.activationProgress.hidden = false;
  els.activationConfirm.disabled = true;
  els.reviewErrors.hidden = true;
  try {
    const payload = await request('/api/setup/confirm', {
      method: 'POST',
      body: JSON.stringify({ draftId: state.draft.draftId }),
    });
    state.payload = payload.dashboard;
    state.jobs = state.payload.jobs || [];
    state.draft = null;
    state.inference = null;
    history.replaceState({}, '', location.pathname);
    renderHeader();
    renderSummary(state.payload);
    renderJobs();
    showDashboard();
    els.statusLine.textContent = payload.cleanup?.previousProfilesRemoved
      ? 'Profile activated. Previous profile data was removed after the new job list loaded.'
      : 'Profile activated, but old local profile caches could not be fully removed. Retry after closing files that may be in use.';
  } catch (error) {
    els.reviewErrors.textContent = error.message;
    els.reviewErrors.hidden = false;
  } finally {
    els.activationProgress.hidden = true;
    els.activationConfirm.disabled = false;
    els.activateProfileBtn.disabled = !els.activationConfirm.checked;
    els.activateProfileBtn.textContent = 'Activate profile';
  }
}

function renderActivationPreview(activation) {
  els.activationPreview.textContent = '';
  const heading = document.createElement('strong');
  heading.textContent = 'Files to activate';
  const list = document.createElement('ul');
  for (const file of activation.files || []) {
    const item = document.createElement('li');
    item.textContent = `${file.path} — ${file.action}`;
    list.append(item);
  }
  els.activationPreview.append(heading, list);
  els.activationPreview.hidden = false;
}

function collectReview() {
  return {
    candidate: {
      full_name: els.reviewName.value,
      email: els.reviewEmail.value,
      phone: els.reviewPhone.value,
      location: els.reviewLocation.value,
      linkedin: els.reviewLinkedin.value,
      github: els.reviewGithub.value,
      portfolio_url: els.reviewPortfolio.value,
    },
    summary: els.reviewSummary.value,
    experience_years: els.reviewYears.value,
    seniority: els.reviewSeniority.value,
    availability: {
      notice_period: els.reviewNoticePeriod.value,
    },
    target_roles: csv(els.reviewTargetRoles.value),
    adjacent_roles: csv(els.reviewAdjacentRoles.value),
    excluded_titles: csv(els.reviewExcludedTitles.value),
    preferences: {
      domains: csv(els.reviewIndustries.value),
    },
    skills: {
      demonstrated: csv(els.reviewSkillsDemonstrated.value),
      confirmed_unlisted: csv(els.reviewSkillsConfirmed.value),
      supporting: csv(els.reviewSkillsSupporting.value),
      learning: csv(els.reviewSkillsLearning.value),
      excluded: csv(els.reviewSkillsExcluded.value),
    },
    location: {
      home_country: els.reviewHomeCountry.value,
      preferred_locations: csv(els.reviewPreferredLocations.value),
      remote_eligibility_required: els.reviewRemoteEligibility.checked,
      remote_regions: csv(els.reviewRemoteRegions.value),
      relocation: els.reviewRelocation.value,
      search_scopes: selectedSearchScopes(),
      international_locations: csv(els.reviewInternationalLocations.value),
      visa_sponsorship_required: els.reviewVisaRequired.checked,
    },
    compensation: {
      currency: els.reviewCurrency.value,
      minimum_annual: els.reviewMinimumAnnual.value,
      target_annual: els.reviewTargetAnnual.value,
    },
  };
}

function selectedSearchScopes() {
  return [
    els.reviewScopeLocal.checked ? 'local' : '',
    els.reviewScopeRemote.checked ? 'remote' : '',
    els.reviewScopeInternational.checked ? 'international' : '',
  ].filter(Boolean);
}

function renderEvidenceList(container, items, formatter) {
  container.textContent = '';
  for (const item of items) {
    const chip = document.createElement('span');
    chip.className = 'evidence-chip';
    chip.textContent = formatter(item);
    container.append(chip);
  }
}

function evidenceText(label, item) {
  if (!item?.value) return '';
  return `${label}: ${percent(item.confidence)} confidence from ${item.source}`;
}

function percent(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function csv(value) {
  return [...new Set(String(value || '').split(',').map((item) => item.trim()).filter(Boolean))];
}

function inferCountry(locationValue) {
  const value = String(locationValue || '').trim();
  if (!value) return '';
  const parts = value.split(',').map((part) => part.trim());
  return parts.length > 1 ? parts.at(-1) : '';
}

function renderSummary(payload) {
  els.totalCount.textContent = payload.stats?.total || 0;
  els.excellentCount.textContent = payload.stats?.excellent || 0;
  els.sourceCount.textContent = payload.stats?.sources || 0;
}

function renderJobs() {
  const jobs = state.jobs.filter(matchesFilter);
  const sourceJobs = jobs.filter((job) => job.type === 'searchLead');
  const realJobs = jobs.filter((job) => job.type !== 'searchLead');
  const recommended = realJobs.filter((job) => Number(job.score) >= 7);
  const review = realJobs.filter((job) => Number(job.score) < 7);
  els.recommendedCount.textContent = recommended.length;
  els.reviewCount.textContent = review.length;
  els.sourceSectionCount.textContent = sourceJobs.length;
  renderList(els.recommendedJobs, recommended);
  renderList(els.reviewJobs, review);
  renderList(els.sourceJobs, sourceJobs);
}

function matchesFilter(job) {
  if (Number(job.score || 0) < state.minScore) return false;
  if (!state.filterText) return true;
  return [
    job.title, job.company, job.location, job.source,
    ...(job.reasons || []), ...(job.matchedSkills || []),
  ].join(' ').toLowerCase().includes(state.filterText);
}

function renderList(container, jobs) {
  container.textContent = '';
  if (jobs.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No jobs in this section yet.';
    container.append(empty);
    return;
  }
  jobs.forEach((job) => container.append(renderJob(job)));
}

function renderJob(job) {
  const row = document.createElement('article');
  row.className = 'job';
  const score = document.createElement('div');
  score.className = `score ${job.score >= 8 ? 'good' : job.score >= 7 ? 'ok' : 'low'}`;
  score.textContent = `${job.score || 0}/10`;
  const main = document.createElement('div');
  main.className = 'job-main';
  const title = document.createElement('div');
  title.className = 'job-title';
  const heading = document.createElement('h3');
  heading.textContent = job.title || 'Untitled role';
  title.append(heading);
  const meta = document.createElement('dl');
  meta.className = 'job-fields';
  addField(meta, 'Organization', job.company);
  addField(meta, 'Job site', job.source);
  addField(meta, 'Matched title', job.matchedTitle || job.titleMatch);
  addField(meta, 'Location', job.locationLabel || job.location);
  addField(meta, 'Experience', job.yearsRequired);
  addField(meta, 'Matched skills', (job.matchedSkills || []).join(', '));
  addField(meta, 'Supporting skills', (job.supportingSkills || []).join(', '));
  addField(meta, 'Skill gaps', (job.recommendedSkillGaps || []).join(', '));
  addField(meta, 'Eligibility', job.eligibility?.label || job.remoteStatus);
  addField(meta, 'Compensation', job.compensation?.label || job.salaryBand);
  addField(meta, 'Urgency', job.urgency || job.priority);
  const reasons = document.createElement('div');
  reasons.className = 'reasons';
  for (const reason of job.reasons || []) {
    const chip = document.createElement('span');
    chip.className = 'reason';
    chip.textContent = reason;
    reasons.append(chip);
  }
  const actions = document.createElement('div');
  actions.className = 'job-actions';
  if (job.type === 'searchLead') {
    if (job.url) actions.append(actionButton('Open search', () => window.open(job.url, '_blank', 'noopener'), 'primary'));
  } else {
    actions.append(
      actionButton('Tailor resume', () => tailorResume(job), 'secondary'),
      actionButton('Open job', () => window.open(job.url, '_blank', 'noopener'), 'primary'),
    );
  }
  main.append(title, meta, reasons, actions);
  row.append(score, main);
  return row;
}

async function tailorResume(job) {
  showDialog('Tailoring resume', `Creating an evidence-preserving resume for ${job.company} - ${job.title}…`);
  try {
    const payload = await request('/api/resume', {
      method: 'POST',
      body: JSON.stringify({ id: job.id }),
    });
    const artifact = payload.artifact;
    showDialog('Tailored resume ready', [
      `${job.company} - ${job.title}`,
      '',
      `PDF: ${location.origin}${artifact.pdfUrl}`,
      `HTML: ${location.origin}${artifact.htmlUrl}`,
      `Change notes: ${location.origin}${artifact.changesUrl}`,
      `Editing prompt: ${location.origin}${artifact.promptUrl}`,
      artifact.pageCount ? `Pages: ${artifact.pageCount}` : '',
      artifact.sizeKb ? `Size: ${artifact.sizeKb} KB` : '',
      '',
      `Verified emphasis: ${(artifact.keywords || []).join(', ')}`,
      '',
      'Review the generated PDF and change notes before using it.',
    ].filter(Boolean).join('\n'));
  } catch (error) {
    showDialog('Resume tailoring failed', error.message);
  }
}

function addField(container, label, value) {
  if (!value) return;
  const term = document.createElement('dt');
  term.textContent = label;
  const description = document.createElement('dd');
  description.textContent = value;
  container.append(term, description);
}

function actionButton(label, action, className = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.className = className;
  button.addEventListener('click', action);
  return button;
}

function showDialog(title, body) {
  els.dialogTitle.textContent = title;
  els.dialogBody.textContent = body;
  if (!els.actionDialog.open) els.actionDialog.showModal();
}

async function request(url, options = {}, json = true) {
  const headers = json ? { 'content-type': 'application/json' } : {};
  const response = await fetch(url, { headers, ...options });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.detail || payload.error || response.statusText);
    error.payload = payload;
    throw error;
  }
  return payload;
}

function setUploadBusy(busy) {
  els.uploadBtn.disabled = busy;
  els.uploadBtn.textContent = busy ? 'Uploading…' : 'Upload resume';
}

function setDashboardBusy(busy) {
  els.refreshBtn.disabled = busy;
  els.refreshBtn.textContent = busy ? 'Refreshing…' : 'Refresh jobs';
}

function setUploadStatus(message, error) {
  els.uploadStatus.hidden = !message;
  els.uploadStatus.textContent = message;
  els.uploadStatus.classList.toggle('error', Boolean(error));
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;
}
