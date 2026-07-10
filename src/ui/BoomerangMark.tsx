export function BoomerangMark() {
  return (
    <span className="boomerang-mark" aria-hidden="true">
      <svg width="18" height="15" viewBox="0 0 76 64" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M16 35H60L55 48C53 54 47 58 38 58C29 58 23 54 21 48L16 35Z"
          fill="var(--logo-mark-shadow)"
          stroke="var(--logo-mark-shadow)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="5"
        />
        <path
          d="M18 33H58L53 46C51 52 46 55 38 55C30 55 25 52 23 46L18 33Z"
          fill="var(--logo-mark-fill)"
          stroke="var(--logo-mark-fill)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="4"
        />
        <path
          d="M22 33C25 23 51 23 54 33M28 30C26 24 29 20 34 18M38 30C36 23 39 19 44 17M48 30C47 24 50 21 55 20"
          fill="none"
          stroke="var(--logo-mark-highlight)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
          opacity="0.75"
        />
        <path
          d="M21 18L56 9"
          fill="none"
          stroke="var(--logo-mark-shadow)"
          strokeLinecap="round"
          strokeWidth="4"
          opacity="0.75"
        />
      </svg>
    </span>
  );
}
