export function getUserId(): string {
  const key = 'partysongs_user_id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
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
