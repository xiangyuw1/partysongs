function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function getUserId(): string {
  const key = 'partysongs_user_id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = generateId();
    localStorage.setItem(key, id);
  }
  return id;
}

export function getUserName(): string {
  const key = 'partysongs_user_name';
  return localStorage.getItem(key) ?? '';
}

export function setUserName(name: string): void {
  localStorage.setItem('partysongs_user_name', name);
}

export function getAdminPassword(): string {
  return sessionStorage.getItem('admin_password') ?? '';
}

export function setAdminPassword(pw: string): void {
  sessionStorage.setItem('admin_password', pw);
}
