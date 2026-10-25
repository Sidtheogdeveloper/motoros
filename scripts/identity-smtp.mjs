// Identity email only: workshop notifications retain their independent local transport.
export function identitySmtp(env = {}) {
  if (!env.IDENTITY_SMTP_PROVIDER || env.IDENTITY_SMTP_PROVIDER === 'mailpit')
    return {
      host: 'mailpit',
      port: '1025',
      from: 'motoros@example.test',
      fromDisplayName: 'MotorOS Local',
      ssl: 'false',
      starttls: 'false',
      auth: 'false',
    };
  if (env.IDENTITY_SMTP_PROVIDER !== 'gmail')
    throw new Error('Unsupported identity email provider');
  const address = env.IDENTITY_SMTP_USERNAME?.trim();
  const password = env.IDENTITY_SMTP_PASSWORD?.replace(/\s/g, '');
  if (!/^[a-zA-Z0-9._%+-]+@gmail\.com$/.test(address || ''))
    throw new Error('A Gmail sender address is required');
  if (!/^[a-zA-Z]{16}$/.test(password || ''))
    throw new Error('A 16-character Google App Password is required');
  return {
    host: 'smtp.gmail.com',
    port: '587',
    from: address,
    user: address,
    password,
    fromDisplayName: 'MotorOS',
    ssl: 'false',
    starttls: 'true',
    auth: 'true',
  };
}
