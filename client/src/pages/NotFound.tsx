export default function NotFound() {
  return (
    <div className="min-h-screen bg-dark-bg text-foreground flex flex-col items-center justify-center gap-3">
      <h1 className="font-[Orbitron] text-3xl text-neon-pink glow-pink">404</h1>
      <p className="font-[Rajdhani] text-muted-foreground">This route is not part of the simulator.</p>
    </div>
  );
}
