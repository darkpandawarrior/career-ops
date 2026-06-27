const _profileParam = new URLSearchParams(location.search).get('profile');

const state = {
  payload: null,
  jobs: [],
  filterText: '',
  minScore: 0,
  draft: null,
  inference: null,
  reviewStep: 0,
  liveness: {},
};

const ids = [
  'refreshBtn', 'changeProfileBtn', 'profileLine', 'topbarProfileBlock',
  'profileSwitcher', 'profileSwitcherBtn', 'profileSwitcherMenu', 'profileSwitcherName', 'profileAvatar',
  'onboardingPanel', 'returningPanel',
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
  'refreshPanel', 'refreshPhaseName', 'refreshElapsed',
];
const els = Object.fromEntries(ids.map((id) => [id, document.querySelector(`#${id}`)]));

els.refreshBtn.addEventListener('click', () => loadDashboard(true));
els.changeProfileBtn.addEventListener('click', showReturningProfile);
els.profileSwitcherBtn.addEventListener('click', toggleProfileMenu);
document.addEventListener('click', (e) => {
  if (!els.profileSwitcher.contains(e.target)) closeProfileMenu();
});
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
  loadProfileSwitcher();
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
  // Auto-bypass onboarding when an active profile already exists
  if (state.payload.setup?.hasActiveProfile) showDashboard();
  else showUpload();
}

async function loadDashboard(force) {
  if (force) {
    // Start the scan — show progress panel immediately, poll until done
    setDashboardBusy(true);
    try {
      await request('/api/refresh', { method: 'POST' });
    } catch (error) {
      els.statusLine.textContent = `Scan failed: ${error.message}`;
      setDashboardBusy(false);
    }
    // Panel stays visible; poll will call loadDashboard(false) on completion
    return;
  }
  // Non-force: just reload cached data
  try {
    state.payload = await request('/api/jobs');
    state.jobs = state.payload.jobs || [];
    renderHeader();
    renderSummary(state.payload);
    renderJobs();
    els.statusLine.textContent = state.payload.diagnostics?.note || 'Dashboard ready.';
  } catch (error) {
    els.statusLine.textContent = `Dashboard failed: ${error.message}`;
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
  if (view !== 'dashboard') els.topbarProfileBlock.hidden = true;
}

function renderHeader() {
  const profile = state.payload?.profile;
  els.profileLine.textContent = profile
    ? [profile.name, profile.headline, profile.location].filter(Boolean).join(' · ')
    : 'No active profile yet';
}

async function loadProfileSwitcher() {
  try {
    const profileParam = new URLSearchParams(location.search).get('profile') || '';
    const data = await request(`/api/profiles${profileParam ? `?profile=${encodeURIComponent(profileParam)}` : ''}`);
    const profiles = data.profiles || [];
    if (profiles.length < 1) return;
    const active = profiles.find((p) => p.active) || profiles[0];
    const initials = active.display_name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    els.profileAvatar.textContent = initials;
    els.profileAvatar.style.background = active.color || 'var(--accent)';
    els.profileSwitcherName.textContent = active.display_name.split(' ')[0];
    els.profileSwitcherMenu.innerHTML = profiles.map((p) => `
      <a class="profile-menu-item${p.active ? ' is-active' : ''}" href="${p.url}" role="menuitem">
        <span class="profile-menu-avatar" style="background:${p.color || 'var(--accent)'}">
          ${p.display_name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
        </span>
        <span class="profile-menu-info">
          <strong>${p.display_name}</strong>
          <span>${p.active ? 'current' : 'switch'}</span>
        </span>
        ${p.active ? '<span class="profile-menu-check" aria-hidden="true">✓</span>' : ''}
      </a>`).join('') + `
      <div class="profile-menu-divider"></div>
      <button class="profile-menu-item profile-menu-add" type="button" role="menuitem">
        <span class="profile-menu-avatar profile-menu-add-icon">+</span>
        <span class="profile-menu-info"><strong>Add new profile</strong><span>Create a new profile</span></span>
      </button>`;
    els.profileSwitcherMenu.querySelector('.profile-menu-add').addEventListener('click', () => {
      closeProfileMenu();
      openAddProfileModal();
    });
    els.profileSwitcher.hidden = false;
    els.topbarProfileBlock.hidden = false;
  } catch {
    // profiles.yml absent or malformed — switcher stays hidden
  }
}

function toggleProfileMenu() {
  const open = !els.profileSwitcherMenu.hidden;
  els.profileSwitcherMenu.hidden = open;
  els.profileSwitcherBtn.setAttribute('aria-expanded', String(!open));
}

function closeProfileMenu() {
  els.profileSwitcherMenu.hidden = true;
  els.profileSwitcherBtn.setAttribute('aria-expanded', 'false');
}

window.openAddProfileModal = openAddProfileModal;
window.closeProfileMenu = closeProfileMenu;
function openAddProfileModal() {
  const modal = document.getElementById('addProfileModal');
  document.getElementById('addProfileForm').reset();
  document.getElementById('addProfileStatus').hidden = true;
  document.getElementById('addProfileSubmitBtn').disabled = false;
  document.getElementById('addProfileSubmitBtn').textContent = 'Create profile';
  modal.showModal();
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('addProfileForm');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const slug = document.getElementById('newProfileSlug').value.trim();
      const displayName = document.getElementById('newProfileDisplayName').value.trim();
      const color = document.getElementById('newProfileColor').value;
      const statusEl = document.getElementById('addProfileStatus');
      const submitBtn = document.getElementById('addProfileSubmitBtn');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Creating…';
      statusEl.hidden = true;
      try {
        const createUrl = _profileParam ? `/api/profiles/create?profile=${encodeURIComponent(_profileParam)}` : '/api/profiles/create';
        const res = await fetch(createUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ slug, display_name: displayName, color }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to create profile');
        statusEl.textContent = `Profile "${displayName}" created! Click it in the switcher to open it.`;
        statusEl.classList.remove('error');
        statusEl.hidden = false;
        submitBtn.textContent = 'Done';
        loadProfileSwitcher();
      } catch (err) {
        statusEl.textContent = err.message;
        statusEl.classList.add('error');
        statusEl.hidden = false;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create profile';
      }
    });
  }
});

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
  startLivenessCheck(realJobs.filter((j) => j.url).slice(0, 15));
}

function matchesFilter(job) {
  if (Number(job.score || 0) < state.minScore) return false;
  if (!state.filterText) return true;
  return [
    job.title, job.company, job.location, job.source,
    ...(job.reasons || []), ...(job.matchedSkills || []),
  ].join(' ').toLowerCase().includes(state.filterText);
}

function normalizeTitle(title) {
  if (!title) return '';
  const t = cleanText(title);
  // Strip trailing " - Anything that looks like a location" (city, country, state)
  // Strategy: strip from " - " if what follows contains a comma (City, Country pattern)
  // or matches a known location pattern
  const dashIdx = t.lastIndexOf(' - ');
  if (dashIdx > 0) {
    const suffix = t.slice(dashIdx + 3);
    // If suffix looks like a location (has comma, or is mostly proper nouns)
    if (suffix.includes(',') || /^[A-Z][a-z]+(?:\s[A-Z][a-z]+)*$/.test(suffix)) {
      return t.slice(0, dashIdx).trim();
    }
  }
  const emDashIdx = t.lastIndexOf(' – ');
  if (emDashIdx > 0) {
    const suffix = t.slice(emDashIdx + 3);
    if (suffix.includes(',') || /^[A-Z]/.test(suffix)) {
      return t.slice(0, emDashIdx).trim();
    }
  }
  return t;
}

function groupByCompany(jobs) {
  const companyMap = new Map();
  for (const job of jobs) {
    const company = job.company || 'Unknown';
    if (!companyMap.has(company)) companyMap.set(company, []);
    companyMap.get(company).push(job);
  }

  // Within each company, merge same-base-title jobs into one card with location variants
  const result = new Map();
  for (const [company, companyJobs] of companyMap) {
    const titleMap = new Map();
    for (const job of companyJobs) {
      const baseTitle = normalizeTitle(job.title);
      if (!titleMap.has(baseTitle)) {
        titleMap.set(baseTitle, { ...job, title: baseTitle, _locations: [] });
      }
      const existing = titleMap.get(baseTitle);
      const loc = cleanLocation(job.locationLabel || job.location || '');
      if (loc && !existing._locations.includes(loc)) existing._locations.push(loc);
      // Keep highest score
      if ((Number(job.score) || 0) > (Number(existing.score) || 0)) {
        existing.score = job.score;
      }
    }
    const merged = [...titleMap.values()].map(j => {
      if (j._locations.length > 1) {
        j.locationLabel = j._locations.slice(0, 3).join(' · ') + (j._locations.length > 3 ? ` +${j._locations.length - 3}` : '');
      } else if (j._locations.length === 1) {
        j.locationLabel = j._locations[0];
      }
      return j;
    });
    result.set(company, merged);
  }
  return result;
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
  const grouped = groupByCompany(jobs);
  for (const [company, companyJobs] of grouped) {
    container.append(renderCompanyGroup(company, companyJobs));
  }
}

function renderCompanyGroup(company, jobs) {
  const section = document.createElement('div');
  section.className = 'co-section';

  const hdr = document.createElement('div');
  hdr.className = 'co-hdr';
  hdr.innerHTML = `<span class="co-name">${tesc(company)}</span><span class="co-line"></span><span class="co-count">${jobs.length}</span>`;
  section.append(hdr);

  const rows = document.createElement('div');
  rows.className = 'co-rows';
  jobs.forEach((job) => rows.append(renderJob(job, false, true)));
  section.append(rows);

  hdr.addEventListener('click', () => section.classList.toggle('co-collapsed'));
  return section;
}

function scoreTier(s) {
  if (s >= 9) return 'excellent';
  if (s >= 7) return 'strong';
  if (s >= 5) return 'good';
  return 'weak';
}

function renderJob(job, defaultExpanded = false, inGroup = false) {
  const scoreVal = Number(job.score) || 0;
  const tier = scoreTier(scoreVal);

  const row = document.createElement('div');
  row.className = `jr${defaultExpanded ? ' jr-open' : ''}`;
  row.dataset.tier = tier;
  if (job.id) row.dataset.jobId = job.id;

  // Left score badge
  const scoreBadge = document.createElement('span');
  scoreBadge.className = 'jr-score';
  scoreBadge.textContent = scoreVal || '–';

  // Body (title + meta chips)
  const body = document.createElement('div');
  body.className = 'jr-body';

  const title = document.createElement('span');
  title.className = 'jr-title';
  title.textContent = cleanText(job.title) || 'Untitled';

  const rawLoc = job.locationLabel || job.location || '';
  const cleanLoc = cleanLocation(rawLoc);
  const metaParts = [];
  if (!inGroup && job.company) metaParts.push(`<span class="jr-co">${tesc(cleanText(job.company))}</span>`);
  if (cleanLoc) metaParts.push(`<span class="jr-loc">${tesc(cleanLoc)}</span>`);
  if (job.yearsRequired) metaParts.push(`<span class="jr-exp">${tesc(cleanText(job.yearsRequired))}</span>`);

  const meta = document.createElement('div');
  meta.className = 'jr-meta';
  meta.innerHTML = metaParts.join('<span class="jr-dot">·</span>');
  body.append(title, meta);

  // Signal chips (skills + reasons)
  const chips = document.createElement('div');
  chips.className = 'jr-chips';
  let chipCount = 0;
  for (const skill of (job.matchedSkills || []).slice(0, 3)) {
    const c = document.createElement('span');
    c.className = 'jchip jchip-skill';
    c.textContent = skill;
    chips.append(c); chipCount++;
  }
  for (const reason of (job.reasons || [])) {
    if (chipCount >= 4) break;
    const label = formatReason(reason);
    if (!label) continue;
    const c = document.createElement('span');
    c.className = 'jchip';
    c.textContent = label;
    chips.append(c); chipCount++;
  }
  // Liveness badge (hidden placeholder)
  if (job.type !== 'searchLead' && job.url && job.id) {
    const lv = document.createElement('span');
    lv.className = `liveness-badge liveness-${state.liveness[job.id] || 'unknown'}`;
    lv.dataset.jobId = job.id;
    const st = state.liveness[job.id];
    if (st === 'live' || st === 'dead') { lv.textContent = st === 'live' ? '● live' : '○ closed'; lv.hidden = false; }
    else { lv.hidden = true; }
    chips.append(lv);
  }

  // Actions (shown on hover)
  const actions = document.createElement('div');
  actions.className = 'jr-actions';
  if (job.type === 'searchLead') {
    if (job.url) {
      const a = document.createElement('a');
      a.href = job.url; a.target = '_blank'; a.rel = 'noopener'; a.className = 'jr-link'; a.textContent = '↗';
      actions.append(a);
    }
  } else {
    if (job.url) {
      const a = document.createElement('a');
      a.href = job.url; a.target = '_blank'; a.rel = 'noopener'; a.className = 'jr-link'; a.textContent = '↗';
      actions.append(a);
    }
    const evalBtn = document.createElement('button');
    evalBtn.type = 'button'; evalBtn.className = 'jr-eval'; evalBtn.textContent = 'Eval';
    evalBtn.addEventListener('click', () => queueEval(job));
    actions.append(evalBtn);
  }

  // Expand toggle
  const expandBtn = document.createElement('button');
  expandBtn.type = 'button'; expandBtn.className = 'jr-expand'; expandBtn.textContent = '…';
  expandBtn.setAttribute('aria-label', 'Details');
  actions.append(expandBtn);

  row.append(scoreBadge, body, chips, actions);

  // Expanded detail panel
  const detail = document.createElement('div');
  detail.className = 'jr-detail';
  const grid = document.createElement('dl');
  grid.className = 'job-fields';
  if (!inGroup) addField(grid, 'Organization', cleanText(job.company));
  addField(grid, 'Job site', cleanText(job.source));
  addField(grid, 'Location', cleanLocation(job.locationLabel || job.location));
  addField(grid, 'Experience', cleanText(job.yearsRequired));
  addField(grid, 'Matched skills', (job.matchedSkills || []).map(cleanText).join(', '));
  addField(grid, 'Supporting skills', (job.supportingSkills || []).map(cleanText).join(', '));
  addField(grid, 'Skill gaps', (job.recommendedSkillGaps || []).map(cleanText).join(', '));
  addField(grid, 'Eligibility', cleanText(job.eligibility?.label || job.remoteStatus));
  addField(grid, 'Compensation', cleanText(job.compensation?.label || job.salaryBand));

  const detailActions = document.createElement('div');
  detailActions.className = 'job-actions';
  if (job.type !== 'searchLead') {
    detailActions.append(
      actionButton('Tailor resume', () => tailorResume(job), 'secondary'),
      actionButton('Fill with AI', () => fillWithAi(job), 'secondary'),
    );
    if (job.url) detailActions.append(actionButton('Open job ↗', () => window.open(job.url, '_blank', 'noopener'), 'primary'));
  }
  detail.append(grid, detailActions);
  row.append(detail);

  expandBtn.addEventListener('click', () => row.classList.toggle('jr-open'));

  return row;
}

async function startLivenessCheck(jobs) {
  if (!jobs || jobs.length === 0) return;
  for (const job of jobs.filter((j) => j.url && j.id)) {
    if (state.liveness[job.id] && state.liveness[job.id] !== 'unknown') continue;
    state.liveness[job.id] = 'checking';
    updateLivenessBadge(job.id, 'checking');
    (async () => {
      try {
        const result = await request('/api/liveness', {
          method: 'POST',
          body: JSON.stringify({ url: job.url }),
        });
        const status = result.live === true ? 'live' : result.live === false ? 'dead' : 'unknown';
        state.liveness[job.id] = status;
        updateLivenessBadge(job.id, status);
      } catch {
        state.liveness[job.id] = 'unknown';
        updateLivenessBadge(job.id, 'unknown');
      }
    })();
  }
}

function updateLivenessBadge(jobId, status) {
  for (const badge of document.querySelectorAll(`.liveness-badge[data-job-id="${jobId}"]`)) {
    badge.className = `liveness-badge liveness-${status}`;
    if (status === 'checking') {
      badge.textContent = '…';
      badge.hidden = false;
    } else if (status === 'live' || status === 'dead') {
      badge.textContent = status === 'live' ? 'live' : 'closed';
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }
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

async function fillWithAi(job) {
  if (!job.url) { showDialog('No URL', 'This job has no application URL.'); return; }
  showDialog('Fill with AI — queued', [
    `Queued for Claude Code:`,
    `  /career-ops apply ${job.url}`,
    '',
    `Claude will open the application page with Playwright and auto-fill every field`,
    `using your CV, profile, and knowledge base.`,
    '',
    `You must be present — Claude will pause before clicking Submit for your review.`,
    '',
    `Open Claude Code and say: "process the agent inbox"`,
  ].join('\n'));
  await request('/api/queue', {
    method: 'POST',
    body: JSON.stringify({ text: `/career-ops apply ${job.url}  # ${job.company} — ${job.title}` }),
  });
  // Always reload console badge regardless of whether tracker tab was visited
  trackerData = null; await loadTrackerData();
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
  const sep = url.includes('?') ? '&' : '?';
  const resolved = _profileParam && url.startsWith('/api/') ? `${url}${sep}profile=${encodeURIComponent(_profileParam)}` : url;
  const response = await fetch(resolved, { headers, ...options });
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

let refreshPollTimer = null;
let refreshStartTs = null;
let refreshElapsedTimer = null;

function setDashboardBusy(busy) {
  els.refreshBtn.disabled = busy;
  els.refreshBtn.textContent = busy ? 'Scanning…' : 'Refresh jobs';
  if (busy) {
    refreshStartTs = Date.now();
    showRefreshPanel(true);
    startRefreshPoll();
  } else {
    showRefreshPanel(false);
    stopRefreshPoll();
  }
}

function showRefreshPanel(show) {
  els.refreshPanel.hidden = !show;
  if (show) {
    // switch to jobs tab so the panel is visible
    const jobsBtn = document.querySelector('[data-tab="jobs"]');
    if (jobsBtn && !jobsBtn.classList.contains('active')) jobsBtn.click();
    // start elapsed timer
    stopElapsedTimer();
    refreshElapsedTimer = setInterval(() => {
      const s = Math.floor((Date.now() - refreshStartTs) / 1000);
      const m = Math.floor(s / 60);
      els.refreshElapsed.textContent = m > 0 ? `${m}m ${s % 60}s elapsed` : `${s}s elapsed`;
    }, 1000);
    updateRefreshStages(0);
  } else {
    stopElapsedTimer();
  }
}

function stopElapsedTimer() {
  if (refreshElapsedTimer) { clearInterval(refreshElapsedTimer); refreshElapsedTimer = null; }
}

function updateRefreshStages(phase) {
  document.querySelectorAll('.refresh-stage').forEach((el) => {
    const p = Number(el.dataset.phase);
    el.classList.toggle('stage-done', p < phase);
    el.classList.toggle('stage-active', p === phase);
    el.classList.toggle('stage-pending', p > phase);
  });
  if (els.refreshPhaseName) {
    const names = ['', 'Scanning company boards', 'Running ATS discovery', 'Fetching job feeds', 'Scoring & saving'];
    els.refreshPhaseName.textContent = names[phase] || 'Working…';
  }
}

function startRefreshPoll() {
  stopRefreshPoll();
  refreshPollTimer = setInterval(async () => {
    try {
      const s = await request('/api/refresh/status');
      updateRefreshStages(s.phase || 1);
      if (!s.running) {
        stopRefreshPoll();
        // reload jobs data now that scan finished
        await loadDashboard(false);
        setDashboardBusy(false);
      }
    } catch { /* server temporarily unreachable — keep polling */ }
  }, 1500);
}

function stopRefreshPoll() {
  if (refreshPollTimer) { clearInterval(refreshPollTimer); refreshPollTimer = null; }
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

// ═══════════════════════════════════════════════════════════════════════════════
// TRACKER TABS — folded in from my-dashboard.mjs
// ═══════════════════════════════════════════════════════════════════════════════

// ── Tab switching ─────────────────────────────────────────────────────────────
let trackerData = null;
let scanRows = [];
let trackerRefreshTimer = null;
let trackerLastUpdated = null;

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach((p) => { p.hidden = p.id !== `tab-${name}`; });
  if (name === 'jobs') {
    clearInterval(trackerRefreshTimer); trackerRefreshTimer = null;
  } else {
    if (!trackerData) loadTrackerData();
    if (!trackerRefreshTimer) {
      trackerRefreshTimer = setInterval(() => { trackerData = null; loadTrackerData(); }, 30000);
    }
    if (name === 'intel') { renderProfile(); renderCoach(); }
    if (name === 'ops') { renderConsole(); renderScanner(); }
  }
}

// ── Wire new buttons ──────────────────────────────────────────────────────────
document.getElementById('queueFreeBtn').addEventListener('click', queueFree);
document.getElementById('freereq').addEventListener('keydown', (e) => { if (e.key === 'Enter') queueFree(); });
document.getElementById('scanBtn').addEventListener('click', () => runScan(false));
document.getElementById('scanVerifyBtn').addEventListener('click', () => runScan(true));
document.getElementById('checkLiveBtn').addEventListener('click', checkLive);
document.getElementById('livenessAllBtn').addEventListener('click', () => {
  const jobs = (state.payload?.jobs || []).filter((j) => j.score >= 7 && j.url && j.id);
  if (jobs.length === 0) return;
  const banner = document.getElementById('livenessBanner');
  document.getElementById('livenessBannerText').textContent = `Checking liveness for ${jobs.length} recommended jobs…`;
  banner.hidden = false;
  startLivenessCheck(jobs);
});
document.getElementById('livenessBannerDismiss').addEventListener('click', () => {
  document.getElementById('livenessBanner').hidden = true;
});
document.getElementById('healthBtn').addEventListener('click', runHealth);
document.getElementById('sc-filter').addEventListener('change', renderScanRows);

// Event delegation for dynamically rendered inbox unqueue buttons
document.getElementById('inbox').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-unqueue-idx]');
  if (!btn || !trackerData) return;
  const idx = Number(btn.dataset.unqueueIdx);
  const pending = trackerData.inbox.filter((i) => !i.done);
  if (pending[idx]) unqueue(pending[idx].text);
});

// ── Data loading ──────────────────────────────────────────────────────────────
async function loadTrackerData() {
  try {
    trackerData = await request('/api/data');
    trackerLastUpdated = Date.now();
    renderTracker();
    renderCoach();
    renderConsole();
    renderScanner();
    renderProfile();
    loadCadence();
    // Update "last updated" timestamp across all tabs
    const el = document.getElementById('tracker-updated');
    if (el) el.textContent = 'Updated just now';
  } catch (e) {
    console.warn('Tracker data unavailable:', e.message);
    const el = document.getElementById('tracker-updated');
    if (el) el.textContent = 'Error: ' + e.message;
  }
}

function relativeTime(ms) {
  const secs = Math.floor((Date.now() - ms) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

// Periodically update the "last updated" label
setInterval(() => {
  if (!trackerLastUpdated) return;
  const el = document.getElementById('tracker-updated');
  if (el) el.textContent = 'Updated ' + relativeTime(trackerLastUpdated);
}, 15000);

async function loadCadence() {
  try {
    const r = await request('/api/cadence');
    if (!r.ok || !r.data) return;
    const rows = (r.data.entries || []).filter((e) => e.urgency !== 'none')
      .sort((a, b) => (a.daysUntilNext || 0) - (b.daysUntilNext || 0));
    document.querySelector('#cadence-table tbody').innerHTML = rows.map((e) => {
      const cls = e.urgency === 'overdue' ? 't-overdue' : e.urgency === 'urgent' ? 't-urgent' : 't-ok';
      return `<tr><td><strong>${tesc(e.company)}</strong></td><td class="t-muted">${tesc(e.status)}</td><td class="${cls}">${tesc(e.urgency)}</td><td class="t-muted">${tesc(e.nextFollowupDate || '—')}</td></tr>`;
    }).join('') || '<tr><td colspan="4" class="t-muted">Nothing actionable right now.</td></tr>';
  } catch { /* cadence script may not exist */ }
}

// ── Minimal helpers ───────────────────────────────────────────────────────────
function tesc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

function stripHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;[^&]*&gt;/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function cleanText(s) {
  if (!s) return '';
  const stripped = stripHtml(s);
  // Truncate at first sentence if very long (>80 chars)
  if (stripped.length > 80) {
    const dot = stripped.indexOf('. ');
    if (dot > 0 && dot < 80) return stripped.slice(0, dot);
    return stripped.slice(0, 80).replace(/\s+\S*$/, '') + '…';
  }
  return stripped;
}

function cleanLocation(s) {
  if (!s) return '';
  const stripped = stripHtml(s);
  // Cut where company description bleeds in after location data
  // Matches: "<location> <Sentence starting word> ..."
  // Common bleed patterns: "The mission", "Our team", "Senior", "We are", "About"
  const descPattern = /^(.{4,50}?(?:,\s*[A-Z][a-z]+)?)\s+(?=[A-Z][a-z]{2,}\s+(?:Android|Mobile|Software|Senior|Lead|Engineer|Product|the |our |we |at |join|come|this|about))/i;
  const m = stripped.match(descPattern);
  if (m) return m[1].replace(/[,\s·]+$/, '');
  // Simple fallback: cut at natural location end (after "Country" or 50 chars)
  // If it looks like "City, Country ExtraStuff", find where ExtraStuff begins
  const commaIdx = stripped.lastIndexOf(',');
  if (commaIdx > 0 && commaIdx < 40) {
    const afterCountry = stripped.slice(commaIdx + 1).trimStart();
    const wordEnd = afterCountry.search(/\s/);
    if (wordEnd > 0) {
      const country = afterCountry.slice(0, wordEnd);
      const remainder = afterCountry.slice(wordEnd).trim();
      if (remainder.length > 5) return stripped.slice(0, commaIdx + 1 + wordEnd).trim();
    }
  }
  if (stripped.length > 50) return stripped.slice(0, 48).replace(/[,\s]+$/, '') + '…';
  return stripped;
}

function formatReason(r) {
  if (!r) return null;
  const s = String(r);
  // "Skills: 6 verified, 1 supporting" → "6 skills matched"
  const skillM = s.match(/Skills?:\s*(\d+)\s*verified/i);
  if (skillM) return `${skillM[1]} skills matched`;
  // "Experience: Experience aligns at 5-9 years" → "exp: 5-9 yrs"
  const expAligns = s.match(/Experience.*aligns.*?(\d[\d-–+]*\s*(?:years?|yrs?))/i);
  if (expAligns) return `exp: ${expAligns[1].replace('years', 'yrs').replace('year', 'yr')}`;
  // "Experience: Role starts at 30 years" → skip
  if (/Experience.*role starts/i.test(s)) return null;
  // "Joining availability" → skip verbose
  if (/joining|availability/i.test(s)) return null;
  // Otherwise truncate to 35 chars
  const clean = stripHtml(s.replace(/^[^:]+:\s*/, ''));
  return clean.length > 35 ? clean.slice(0, 33) + '…' : clean;
}
function tattr(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
function ttoast(msg) {
  let t = document.getElementById('t-toast');
  if (!t) { t = document.createElement('div'); t.id = 't-toast'; t.className = 't-toast'; document.body.append(t); }
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1400);
}

function tmd(text) {
  const lines = String(text).split('\n');
  const out = []; let inUl = false; let inTable = false;
  const inline = (s) => tesc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  for (const l of lines) {
    if (/^\|/.test(l)) {
      if (/^\|[\s\-|]+\|$/.test(l)) continue;
      if (!inTable) { out.push('<table class="t-md-table">'); inTable = true; }
      out.push('<tr>' + l.split('|').slice(1, -1).map((c) => `<td>${inline(c.trim())}</td>`).join('') + '</tr>');
      continue;
    } else if (inTable) { out.push('</table>'); inTable = false; }
    if (/^- /.test(l)) { if (!inUl) { out.push('<ul>'); inUl = true; } out.push(`<li>${inline(l.slice(2))}</li>`); continue; }
    else if (inUl) { out.push('</ul>'); inUl = false; }
    if (/^### /.test(l)) out.push(`<h4>${inline(l.slice(4))}</h4>`);
    else if (/^## /.test(l)) out.push(`<h3>${inline(l.slice(3))}</h3>`);
    else if (/^# /.test(l)) out.push(`<h2>${inline(l.slice(2))}</h2>`);
    else if (/^---+$/.test(l)) out.push('<hr>');
    else if (l.trim() === '') out.push('<p></p>');
    else out.push(`<p>${inline(l)}</p>`);
  }
  if (inUl) out.push('</ul>'); if (inTable) out.push('</table>');
  return out.join('\n');
}

// ── Tracker tab ───────────────────────────────────────────────────────────────
function renderTracker() {
  if (!trackerData) return;
  const { apps, pipeline, reports, states } = trackerData;

  // Pipeline funnel
  const funnelStages = ['Applied', 'Screening', 'Interview', 'Offer', 'Rejected', 'Withdrawn'];
  const counts = {};
  for (const st of funnelStages) counts[st] = 0;
  for (const a of apps) {
    const s = (a.status || '').trim();
    if (counts[s] !== undefined) counts[s]++;
    else {
      const match = funnelStages.find(f => s.toLowerCase().includes(f.toLowerCase()));
      if (match) counts[match]++;
    }
  }
  const funnelColors = { Applied: 'var(--accent)', Screening: '#8b5cf6', Interview: '#2563eb', Offer: 'var(--good)', Rejected: 'var(--bad)', Withdrawn: 'var(--muted)' };
  const funnelEl = document.getElementById('tracker-funnel');
  if (funnelEl) {
    funnelEl.innerHTML = funnelStages.map(st => `
      <div class="funnel-stage">
        <span class="funnel-num" style="color:${funnelColors[st]}">${counts[st]}</span>
        <span class="funnel-lbl">${st}</span>
      </div>`).join('<span class="funnel-arrow">›</span>');
  }

  document.querySelector('#apps-table tbody').innerHTML = apps.map((a) => {
    const statusSlug = (a.status || '').replace(/\s+/g, '-');
    const opts = states.map((st) => `<option${st === a.status ? ' selected' : ''}>${tesc(st)}</option>`).join('');
    const rep = a.report && a.report !== '—'
      ? a.report.replace(/\[([^\]]+)\]\(([^)]+)\)/, `<a href="#" onclick="openReport('${tattr((a.report.match(/\(([^)]+)\)/) || [])[1] || '')}');return false">$1</a>`)
      : '—';
    const notesRaw = a.notes || '';
    const notesShort = notesRaw.length > 60 ? notesRaw.slice(0, 58) + '…' : notesRaw;
    return `<tr class="apps-table-row">
      <td><strong>${tesc(a.company)}</strong></td>
      <td><div class="t-role-cell" title="${tattr(a.role)}">${tesc(a.role)}</div></td>
      <td class="t-muted">${new Date(a.date + 'T00:00').toLocaleDateString('en-US', {month:'short',day:'numeric'})}</td>
      <td>${tesc(a.score)}</td>
      <td>
        <select class="t-select-sm t-select-status t-b-${tesc(statusSlug)}" onchange="setStatus(this)" data-c="${tattr(a.company)}" data-r="${tattr(a.role)}">${opts}</select>
      </td>
      <td><span class="t-report-link">${rep}</span></td>
      <td class="t-muted t-notes-cell"><span class="t-editnote" title="${tattr(notesRaw)}" onclick="editNote(this)" data-c="${tattr(a.company)}" data-r="${tattr(a.role)}">${tesc(notesShort)}</span></td>
    </tr>`;
  }).join('') || '<tr><td colspan="7" class="t-muted">No applications yet.</td></tr>';

  function truncateUrl(url, max = 55) {
    if (!url || url.length <= max) return url;
    return url.slice(0, max) + '…';
  }

  document.getElementById('apps-pipeline').innerHTML = pipeline.length
    ? pipeline.map((p) => `<div class="pipeline-card${p.done ? ' pipeline-card-done' : ''}">
        <input type="checkbox" ${p.done ? 'checked' : ''} onchange="togglePipe(this)" data-u="${tattr(p.url)}" class="pipeline-checkbox">
        <div class="pipeline-card-body">
          <div class="pipeline-card-header">
            <strong class="pipeline-company">${tesc(p.company)}</strong>
            ${p.title ? `<span class="pipeline-role t-muted">${tesc(p.title)}</span>` : ''}
          </div>
          <a class="pipeline-url t-mono" href="${tattr(p.url)}" target="_blank" rel="noopener" title="${tattr(p.url)}">${tesc(truncateUrl(p.url))}</a>
        </div>
        <button class="pipeline-evaluate-btn" onclick="composeQueue('/career-ops oferta ${tattr(p.url)}', null)" title="Queue evaluation">Evaluate</button>
      </div>`).join('')
    : '<p class="t-muted">Inbox empty — run a scan.</p>';

  document.getElementById('apps-reports').innerHTML = reports.length
    ? reports.map((r) => `<span class="t-pill" style="cursor:pointer" onclick="openReport('${tattr(r)}')">${tesc(r)}</span>`).join('')
    : '<p class="t-muted">No reports yet.</p>';
}

window.clearCompletedInbox = async function clearCompletedInbox() {
  if (!trackerData) return;
  for (const item of trackerData.inbox.filter((i) => i.done)) {
    try { await request('/api/queue-remove', { method: 'POST', body: JSON.stringify({ text: item.text }) }); } catch { /* best effort */ }
  }
  trackerData = null;
  await loadTrackerData();
};

async function openReport(name) {
  name = (name || '').replace(/^.*\//, '');
  if (!name) return;
  const resp = await fetch(`/api/report/${encodeURIComponent(name)}`);
  document.getElementById('report-view').innerHTML = tmd(await resp.text());
  switchTab('tracker');
}

async function setStatus(el) {
  try {
    await request('/api/status', { method: 'POST', body: JSON.stringify({ company: el.dataset.c, role: el.dataset.r, status: el.value }) });
    ttoast('Status saved');
  } catch (e) { ttoast('Error: ' + e.message); }
  trackerData = null; await loadTrackerData();
}

async function editNote(el) {
  const cur = el.textContent;
  const v = prompt(`Notes for ${el.dataset.c}:`, cur);
  if (v === null || v === cur) return;
  try {
    await request('/api/notes', { method: 'POST', body: JSON.stringify({ company: el.dataset.c, role: el.dataset.r, notes: v }) });
    ttoast('Note saved');
  } catch (e) { ttoast('Error: ' + e.message); }
  trackerData = null; await loadTrackerData();
}

async function togglePipe(el) {
  try {
    await request('/api/pipeline-toggle', { method: 'POST', body: JSON.stringify({ url: el.dataset.u, done: el.checked }) });
  } catch (e) { el.checked = !el.checked; ttoast('Error: ' + e.message); return; }
  trackerData = null; await loadTrackerData();
}

// ── Coach tab ─────────────────────────────────────────────────────────────────
function renderCoach() {
  if (!trackerData?.coach) {
    document.getElementById('co-stories').innerHTML = '<p class="t-muted">Coach state not found (coaching_state.md).</p>';
    return;
  }
  const co = trackerData.coach;
  document.getElementById('co-stories').innerHTML = co.stories.map((st) => {
    const det = co.details[st.id];
    const retired = /RETIRED/.test(st.strength + st.title);
    return `<details${retired ? ' style="opacity:.5"' : ''}>
      <summary><span><code class="t-code-id">${tesc(st.id)}</code> ${tesc(st.title)}</span><strong class="t-strength">${tesc(st.strength)}</strong></summary>
      <div class="t-detail"><p class="t-muted">${tesc(st.skill)} · ${tesc(st.skill2)}</p>${det ? tmd(det.body) : '<em>no details</em>'}</div>
    </details>`;
  }).join('') || '<p class="t-muted">No stories yet.</p>';

  document.getElementById('co-stage').textContent = `(stage ${co.drillStage} · gates: ${co.gatesPassed})`;
  document.getElementById('co-drills').innerHTML = (co.drillQueue || '').split(';').filter(Boolean).map((x) => `<span class="t-pill">${tesc(x.trim())}</span>`).join('');
  document.getElementById('co-strategy').innerHTML = co.strategy.slice(0, 5).map((x) => `<li>${tesc(x)}</li>`).join('');
  document.getElementById('co-patterns').innerHTML =
    co.effectivePatterns.map((x) => `<li>✅ ${tesc(x)}</li>`).join('') +
    co.ineffectivePatterns.map((x) => `<li>❌ ${tesc(x)}</li>`).join('');
  document.getElementById('co-companies').innerHTML = co.companyPatterns.map((cp) =>
    `<details><summary>${tesc(cp.company)}</summary><div class="t-detail">${tmd(cp.body)}</div></details>`
  ).join('');
  document.querySelector('#co-questions tbody').innerHTML = co.questions.map((q) =>
    `<tr><td><strong>${tesc(q.company)}</strong></td><td class="t-muted">${tesc(q.question)}</td><td class="${/advanced/.test(q.outcome) ? 't-ok' : /reject/.test(q.outcome) ? 't-overdue' : 't-muted'}">${tesc(q.outcome)}</td></tr>`
  ).join('') || '<tr><td colspan="3" class="t-muted">No questions logged.</td></tr>';
  document.querySelector('#co-outcomes tbody').innerHTML = co.outcomes.map((o) =>
    `<tr><td><strong>${tesc(o.company)}</strong><div class="t-muted">${tesc(o.role)}</div></td><td class="t-muted">${tesc(o.round)}</td><td class="${/advanced|submitted/.test(o.result) ? 't-ok' : /reject|stall/.test(o.result) ? 't-overdue' : 't-muted'}">${tesc(o.result)}</td><td class="t-muted">${tesc(o.notes)}</td></tr>`
  ).join('') || '<tr><td colspan="4" class="t-muted">No outcomes logged.</td></tr>';
  document.getElementById('co-notes').innerHTML = co.coachingNotes.map((n) => `<li>${tesc(n)}</li>`).join('') || '<li class="t-muted">No notes.</li>';
  document.querySelector('#co-sessions tbody').innerHTML = co.sessionLog.map((s) =>
    `<tr><td class="t-muted">${tesc(s.date)}</td><td class="t-mono">${tesc(s.commands)}</td><td class="t-muted">${tesc(s.outcomes)}</td></tr>`
  ).join('') || '<tr><td colspan="3" class="t-muted">No sessions logged.</td></tr>';
}

// ── Console tab ───────────────────────────────────────────────────────────────
function renderConsole() {
  if (!trackerData) return;
  const { commands, inbox } = trackerData;
  document.getElementById('cmds-career').innerHTML = (commands['career-ops'] || []).map(cmdCard).join('');
  document.getElementById('cmds-coach').innerHTML = (commands['interview-coach'] || []).map(cmdCard).join('');

  const pending = inbox.filter((i) => !i.done);
  const done = inbox.filter((i) => i.done);

  function parsePriority(text) {
    if (/urgent|asap|today/i.test(text)) return { label: 'urgent', cls: 'inbox-priority-amber' };
    if (/interview|apply/i.test(text)) return { label: 'action', cls: 'inbox-priority-blue' };
    return { label: null, cls: 'inbox-priority-gray' };
  }

  function parseTimestamp(text) {
    const m = String(text).match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s*[—–-]\s*/);
    if (!m) return { ts: null, body: text };
    return { ts: m[1], body: text.slice(m[0].length) };
  }

  const inboxEl = document.getElementById('inbox');
  let html = '';

  if (pending.length === 0 && done.length === 0) {
    html = '<p class="t-muted">Queue empty — add requests above or copy commands below.</p>';
  } else {
    if (pending.length > 0) {
      html += pending.map((item, idx) => {
        const { ts, body } = parseTimestamp(item.text);
        const { label, cls } = parsePriority(item.text);
        return `<div class="inbox-card inbox-card-pending">
          <div class="inbox-card-dot">◷</div>
          <div class="inbox-card-body">
            ${label ? `<span class="inbox-priority-chip ${cls}">${tesc(label)}</span>` : ''}
            <span class="inbox-card-text">${tesc(body)}</span>
            ${ts ? `<span class="inbox-card-ts">${tesc(ts)}</span>` : ''}
          </div>
          <button data-unqueue-idx="${idx}" class="inbox-remove-btn" title="Remove">✕</button>
        </div>`;
      }).join('');
    } else {
      html += '<p class="t-muted" style="margin-bottom:8px">Queue empty — add requests above.</p>';
    }

    if (done.length > 0) {
      html += `<details class="inbox-done-section" style="margin-top:10px">
        <summary class="inbox-done-summary">Completed <span class="inbox-done-badge">${done.length}</span></summary>
        <div class="inbox-done-list">
          ${done.map((i) => {
            const { ts, body } = parseTimestamp(i.text);
            return `<div class="inbox-done-item"><span class="inbox-done-text">${tesc(body)}</span>${ts ? `<span class="inbox-card-ts">${tesc(ts)}</span>` : ''}</div>`;
          }).join('')}
          <button class="inbox-clear-btn" onclick="clearCompletedInbox()">Clear completed</button>
        </div>
      </details>`;
    }
  }

  inboxEl.innerHTML = html;

  const q = pending.length;
  const badge = document.getElementById('queueBadge');
  badge.hidden = !q; badge.textContent = q;
}

function cmdCard(c) {
  const hasArg = c.cmd.includes('{');
  const inputId = 'arg-' + c.cmd.replace(/[^a-z]/gi, '');
  return `<div class="cmd-card">
    <strong>${tesc(c.label)}${c.live ? ' <span class="t-live">● live</span>' : ''}</strong>
    <div class="t-muted" style="font-size:12px;flex:1">${tesc(c.desc)}</div>
    ${hasArg ? `<input type="text" id="${inputId}" class="t-input" placeholder="${tattr(c.arg)}">` : ''}
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button onclick="composeCopy('${tattr(c.cmd)}',${hasArg ? `'${inputId}'` : 'null'})" style="font-size:12px;padding:4px 10px">Copy</button>
      ${c.live ? '' : `<button class="primary" onclick="composeQueue('${tattr(c.cmd)}',${hasArg ? `'${inputId}'` : 'null'})" style="font-size:12px;padding:4px 10px">Queue</button>`}
    </div>
  </div>`;
}

function compose(cmd, inputId) {
  if (inputId) {
    const v = (document.getElementById(inputId) || {}).value || '';
    if (cmd.includes('{') && !v) { ttoast('Needs an argument'); return null; }
    return cmd.replace(/\{[^}]+\}/, v);
  }
  return cmd;
}

function composeCopy(cmd, inputId) {
  const c = compose(cmd, inputId);
  if (c) { navigator.clipboard.writeText(c); ttoast('Copied: ' + c.slice(0, 40)); }
}

async function composeQueue(cmd, inputId) {
  const c = compose(cmd, inputId);
  if (!c) return;
  try {
    await request('/api/queue', { method: 'POST', body: JSON.stringify({ text: c }) });
    ttoast('Queued for Claude');
  } catch (e) { ttoast('Error: ' + e.message); return; }
  trackerData = null; await loadTrackerData();
}

async function queueFree() {
  const inp = document.getElementById('freereq');
  const v = inp.value.trim();
  if (!v) return;
  try {
    await request('/api/queue', { method: 'POST', body: JSON.stringify({ text: v }) });
    inp.value = '';
    ttoast('Queued for Claude');
  } catch (e) { ttoast('Error: ' + e.message); return; }
  trackerData = null; await loadTrackerData();
}

async function unqueue(text) {
  try {
    await request('/api/queue-remove', { method: 'POST', body: JSON.stringify({ text }) });
  } catch (e) { ttoast('Error: ' + e.message); return; }
  trackerData = null; await loadTrackerData();
}

// ── Scanner tab ───────────────────────────────────────────────────────────────
function renderScanner() {
  if (!trackerData) return;
  const { scan, portals } = trackerData;
  scanRows = scan.rows || [];
  document.getElementById('sc-stats').textContent = `${scan.total} urls · last scan ${scan.lastScan || 'never'}`;
  document.getElementById('sc-count').textContent = `(${portals.companies.filter((c) => c.enabled).length} enabled)`;

  const sel = document.getElementById('sc-filter');
  const cur = sel.value;
  sel.innerHTML = '<option value="">all statuses</option>' +
    Object.keys(scan.byStatus || {}).map((k) => `<option${cur === k ? ' selected' : ''}>${tesc(k)}</option>`).join('');

  document.getElementById('sc-companies').innerHTML = portals.companies.map((c) =>
    `<span class="t-pill${c.enabled ? '' : ' t-pill-off'}" title="${tattr(c.notes)}">${tesc(c.name)}</span>`
  ).join('');
  document.getElementById('sc-queries').innerHTML = portals.queries.map((q) =>
    `<span class="t-pill${q.enabled ? '' : ' t-pill-off'}">${tesc(q.name)}</span>`
  ).join('');
  renderScanRows();
}

function renderScanRows() {
  const f = document.getElementById('sc-filter').value;
  const rows = scanRows.filter((r) => !f || r.status === f).slice(0, 80);
  document.querySelector('#sc-table tbody').innerHTML = rows.map((r) => {
    const good = r.status === 'added'; const bad = /expired|no_apply|blocked|invalid/.test(r.status);
    return `<tr>
      <td class="t-muted">${tesc(r.first_seen)}</td>
      <td><strong>${tesc(r.company)}</strong></td>
      <td><a href="${tattr(r.url)}" target="_blank" rel="noopener">${tesc(r.title)}</a></td>
      <td class="t-muted">${tesc(r.portal)}</td>
      <td class="${good ? 't-ok' : bad ? 't-overdue' : 't-muted'}">${tesc(r.status)}</td>
      <td class="t-muted">${tesc(r.location || '')}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" class="t-muted">No scan history.</td></tr>';
}

async function runScan(verify) {
  switchTab('ops');
  const out = document.getElementById('scan-out');
  out.hidden = false;
  out.textContent = verify ? 'Running scan + Playwright verify… (may take a couple of minutes)' : 'Running zero-token scan…';
  try {
    const r = await request(verify ? '/api/scan-verify' : '/api/scan', { method: 'POST' });
    out.textContent = r.output || 'done';
  } catch (e) {
    out.textContent = 'Scan error: ' + e.message;
    return;
  }
  trackerData = null; await loadTrackerData();
}

async function checkLive() {
  const u = document.getElementById('liveurl').value.trim();
  if (!u) return;
  const out = document.getElementById('scan-out');
  out.hidden = false; out.textContent = `Checking ${u} …`;
  const r = await request('/api/liveness', { method: 'POST', body: JSON.stringify({ url: u }) });
  out.textContent = r.output || JSON.stringify(r);
}

// ── Profile tab ───────────────────────────────────────────────────────────────
function renderProfile() {
  const profile = state.payload?.profile || {};
  const comp = profile.compensation || {};
  const tr = profile.target_roles || {};
  const narr = profile.narrative || {};

  document.getElementById('pr-comp').innerHTML = `
    <div style="font-size:20px;font-weight:750;color:#047857">${tesc(comp.target_range || (comp.target_annual ? `${comp.currency || ''} ${comp.target_annual}`.trim() : '—'))}</div>
    <div class="t-muted">walk-away: ${tesc(comp.minimum || comp.minimum_annual || '—')} · ${tesc(comp.location_flexibility || '')}</div>`;

  document.getElementById('pr-arch').innerHTML = (tr.archetypes || []).map((a) =>
    `<span class="t-pill">${tesc(a.name)} <span class="t-muted">[${tesc(a.fit)}]</span></span>`
  ).join('') || '<span class="t-muted">No archetypes configured.</span>';

  document.getElementById('pr-powers').innerHTML = (narr.superpowers || []).map((p) => `<li>${tesc(p)}</li>`).join('') || '<li class="t-muted">No superpowers configured.</li>';

  if (trackerData?.coach) {
    document.getElementById('pr-coachprofile').innerHTML = trackerData.coach.profileBullets.slice(0, 8).map((b) => `<li>${tesc(b)}</li>`).join('');
  }

  const cvUrl = _profileParam ? `/api/cv?profile=${encodeURIComponent(_profileParam)}` : '/api/cv';
  fetch(cvUrl).then((r) => r.ok ? r.text() : Promise.reject(r.status)).then((t) => {
    document.getElementById('pr-cv').innerHTML = tmd(t);
  }).catch(() => {
    document.getElementById('pr-cv').innerHTML = '<span class="t-muted">cv.md not found — run the onboarding flow to generate it.</span>';
  });
}

async function runHealth() {
  const out = document.getElementById('health-out');
  out.hidden = false; out.textContent = 'Running verify-pipeline.mjs…';
  const r = await request('/api/pipeline-health', { method: 'POST' });
  out.textContent = r.output || 'done';
}

// ── Expose module-scoped functions to window for inline onclick= handlers ──────
// app.js runs as type="module" — top-level names are NOT global by default.
// Every function referenced from innerHTML onclick= attributes must be on window.
window.setStatus    = setStatus;
window.editNote     = editNote;
window.togglePipe   = togglePipe;
window.openReport   = openReport;
window.composeCopy  = composeCopy;
window.composeQueue = composeQueue;
window.unqueue      = unqueue;
