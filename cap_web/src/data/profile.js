// Basic information never changes detection, hardware outputs or audio consent.
export function profileFromForm(form, previous = {}, outputs = {}) {
  const name = String(form.get('name') ?? '').trim();
  if (!name || name.length > 24) throw new Error('이름이나 별명을 24자 이내로 적어 주세요.');
  const rawAge = String(form.get('age') ?? '').trim();
  const age = rawAge ? Number(rawAge) : null;
  if (age !== null && (!Number.isInteger(age) || age < 1 || age > 120)) throw new Error('나이는 1~120 사이의 숫자로 입력하거나 비워 주세요.');
  return {
    ...previous, name, age, mode: '보행·발 움직임 관찰', configured: true,
    goals: ['fog', 'ankle', 'front'],
    preferredCues: ['laser', 'vibration', 'voice'].filter(key => outputs[key] === true),
    outputs: { ...outputs },
  };
}
