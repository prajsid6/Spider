export const normalizePhoneNumber = (value: string): string => {
  const trimmedValue = value.trim();
  const digits = trimmedValue.replace(/\D/g, '');
  const internationalNumber = trimmedValue.startsWith('+')
    ? `+${digits}`
    : digits.length === 10
      ? `+91${digits}`
      : `+${digits}`;

  if (!/^\+[1-9]\d{7,14}$/.test(internationalNumber)) {
    throw new Error('Enter a valid phone number with country code, such as +91 9876543210.');
  }
  return internationalNumber;
};
