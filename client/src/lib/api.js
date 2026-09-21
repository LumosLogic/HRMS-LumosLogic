const getToken    = () => localStorage.getItem('lt_token');
const getBranchId = () => localStorage.getItem('lt_selected_branch'); // null = All Branches

async function apiFetch(method, endpoint, body = null) {
  const token    = getToken();
  const branchId = getBranchId();
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token    ? { Authorization: `Bearer ${token}` } : {}),
      ...(branchId ? { 'X-Branch-Id': branchId }         : {}),
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res  = await fetch('/api' + endpoint, opts);
  const data = await res.json().catch(() => ({}));

  if (res.status === 401) {
    if (token) {
      // Token expired or invalid mid-session — signal auth context to logout
      window.dispatchEvent(new CustomEvent('auth:expired'));
      throw new Error('Session expired. Please log in again.');
    }
    // No token means this is a login attempt — show the actual server error
    throw new Error(data.error || 'Invalid email or password');
  }

  if (res.status === 403) {
    throw new Error(data.error || 'You don\'t have permission to perform this action');
  }

  if (res.status === 503 && data.maintenance) {
    window.dispatchEvent(new CustomEvent('maintenance:active', { detail: data }));
    throw new Error('System is under scheduled maintenance. Please try again later.');
  }

  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const apiGet    = (ep, qs = {}) => {
  const q = new URLSearchParams(qs).toString();
  return apiFetch('GET', ep + (q ? '?' + q : ''));
};
export const apiPost   = (ep, body) => apiFetch('POST',   ep, body);
export const apiPut    = (ep, body) => apiFetch('PUT',    ep, body);
export const apiPatch  = (ep, body) => apiFetch('PATCH',  ep, body);
export const apiDelete = (ep, body) => apiFetch('DELETE', ep, body);

// Multipart file upload — does not set Content-Type (browser sets boundary automatically)
export async function apiUpload(ep, formData) {
  const token = getToken();
  const res  = await fetch('/api' + ep, {
    method:  'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body:    formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// Authenticated blob download — sends Bearer token + X-Branch-Id, returns Blob.
// Use for CSV exports, PDF downloads, or any binary endpoint.
export async function apiDownload(ep, qs = {}) {
  const token    = getToken();
  const branchId = getBranchId();
  const q = new URLSearchParams(qs).toString();
  const res = await fetch('/api' + ep + (q ? '?' + q : ''), {
    method: 'GET',
    headers: {
      ...(token    ? { Authorization: `Bearer ${token}` } : {}),
      ...(branchId ? { 'X-Branch-Id': branchId }         : {}),
    },
  });
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('auth:expired'));
    throw new Error('Session expired. Please log in again.');
  }
  if (res.status === 403) throw new Error('You don\'t have permission to perform this action');
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.blob();
}
