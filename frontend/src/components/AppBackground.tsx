export type AppBackgroundVariant =
  | 'launcher'
  | 'meds'
  | 'cats'
  | 'games'
  | 'stats'
  | 'links'
  | 'buy'
  | 'rates'
  | 'admin';

type AppBackgroundProps = {
  variant: AppBackgroundVariant;
};

export function AppBackground({ variant }: AppBackgroundProps) {
  return (
    <>
      <div className={`app-bg app-bg-${variant}`} aria-hidden />
      {variant === 'launcher' || variant === 'admin' ? (
        <>
          <div className="app-orb app-orb-a" aria-hidden />
          <div className="app-orb app-orb-b" aria-hidden />
        </>
      ) : null}
      {variant === 'launcher' ? <div className="app-grid" aria-hidden /> : null}
      {variant === 'cats' ? <div className="app-orb app-orb-cats" aria-hidden /> : null}
      {variant === 'games' ? <div className="app-orb app-orb-games" aria-hidden /> : null}
      {variant === 'stats' ? <div className="app-orb app-orb-stats" aria-hidden /> : null}
      {variant === 'links' ? <div className="app-orb app-orb-links" aria-hidden /> : null}
      {variant === 'buy' ? <div className="app-orb app-orb-buy" aria-hidden /> : null}
      {variant === 'rates' ? <div className="app-orb app-orb-rates" aria-hidden /> : null}
    </>
  );
}
