import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { Zap, Volume2, Share2, Download, ChevronRight } from "lucide-react";
import { startLogin } from "@/const";

export default function Home() {
  const { isAuthenticated } = useAuth();
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen bg-dark-bg overflow-hidden">
      {/* Header */}
      <header className="border-b border-hud-line/20 bg-dark-surface/50 backdrop-blur-sm">
        <div className="container flex items-center justify-between h-14">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-[Orbitron] font-bold text-neon-pink glow-pink tracking-wider">
              ESS
            </h1>
            <span className="text-xs font-[Rajdhani] text-muted-foreground hidden sm:block">
              ENGINE SOUND SIMULATOR
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/gallery')}
              className="text-xs font-[Rajdhani] text-muted-foreground hover:text-neon-cyan"
            >
              Gallery
            </Button>
            {isAuthenticated ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/my-engines')}
                className="text-xs font-[Rajdhani] text-muted-foreground hover:text-neon-cyan"
              >
                My Engines
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => startLogin()}
                className="text-xs font-[Rajdhani] border-neon-cyan/40 text-neon-cyan hover:bg-neon-cyan/10"
              >
                Sign In
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative py-24 md:py-32">
        {/* Background effects */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-neon-pink/5 rounded-full blur-[100px]" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-neon-cyan/5 rounded-full blur-[100px]" />
          {/* Grid lines */}
          <div className="absolute inset-0 opacity-[0.03]" style={{
            backgroundImage: 'linear-gradient(oklch(0.75 0.18 195) 1px, transparent 1px), linear-gradient(90deg, oklch(0.75 0.18 195) 1px, transparent 1px)',
            backgroundSize: '60px 60px',
          }} />
        </div>

        <div className="container relative">
          <div className="max-w-3xl mx-auto text-center space-y-8">
            {/* Title */}
            <div className="space-y-4">
              <h2 className="text-4xl md:text-6xl font-[Orbitron] font-black text-foreground leading-tight">
                <span className="text-neon-pink glow-pink">Design</span> Your
                <br />
                Engine <span className="text-neon-cyan glow-cyan">Sound</span>
              </h2>
              <p className="text-lg md:text-xl font-[Rajdhani] text-muted-foreground max-w-xl mx-auto leading-relaxed">
                Build virtual engines from scratch. Configure cylinders, crankshafts, 
                exhaust systems, and forced induction — then hear them roar in real time.
              </p>
            </div>

            {/* CTA */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button
                onClick={() => navigate('/simulator')}
                className="h-13 px-8 font-[Orbitron] text-sm uppercase tracking-wider bg-neon-pink/20 border-2 border-neon-pink text-neon-pink hover:bg-neon-pink/30 box-glow-pink transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                variant="outline"
              >
                <Zap className="w-4 h-4 mr-2" />
                Launch Simulator
              </Button>
              <Button
                onClick={() => navigate('/gallery')}
                variant="outline"
                className="h-13 px-8 font-[Rajdhani] text-sm uppercase tracking-wider border-hud-line text-muted-foreground hover:border-neon-cyan/50 hover:text-neon-cyan"
              >
                Browse Community
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-16 border-t border-hud-line/10">
        <div className="container">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <FeatureCard
              icon={<Volume2 className="w-5 h-5" />}
              title="Real-Time Audio"
              description="Hear your engine instantly. Every parameter change produces immediate audible feedback with zero interruption."
              color="pink"
            />
            <FeatureCard
              icon={<Zap className="w-5 h-5" />}
              title="Hybrid Synthesis"
              description="Procedural combustion pulses layered with sample-based textures for convincing, realistic engine sounds."
              color="cyan"
            />
            <FeatureCard
              icon={<Download className="w-5 h-5" />}
              title="Export Audio"
              description="Export your creations as high-quality WAV or MP3 files with clipping protection and normalization."
              color="purple"
            />
            <FeatureCard
              icon={<Share2 className="w-5 h-5" />}
              title="Community"
              description="Share your engine designs, browse others' creations, and clone presets into your own workspace."
              color="cyan"
            />
          </div>
        </div>
      </section>

      {/* Engine Types Preview */}
      <section className="py-16 border-t border-hud-line/10">
        <div className="container">
          <h3 className="text-center text-sm font-[Orbitron] text-muted-foreground uppercase tracking-widest mb-8">
            Configure Any Engine
          </h3>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {['Inline-4', 'V6', 'V8 Cross-Plane', 'Flat-Plane V8', 'V10', 'V12', 'Flat-6', 'W16', 'Radial'].map((engine) => (
              <span
                key={engine}
                className="px-3 py-1.5 text-xs font-[Rajdhani] font-medium border border-hud-line/30 rounded text-muted-foreground hover:border-neon-cyan/40 hover:text-neon-cyan transition-colors cursor-default"
              >
                {engine}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-hud-line/10 py-8">
        <div className="container text-center">
          <p className="text-xs font-[Rajdhani] text-muted-foreground">
            Engine Sound Simulator — Concept design tool for engine audio creation
          </p>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, description, color }: { icon: React.ReactNode; title: string; description: string; color: 'pink' | 'cyan' | 'purple' }) {
  const colorMap = {
    pink: 'border-neon-pink/20 hover:border-neon-pink/40',
    cyan: 'border-neon-cyan/20 hover:border-neon-cyan/40',
    purple: 'border-neon-purple/20 hover:border-neon-purple/40',
  };
  const iconColorMap = {
    pink: 'text-neon-pink',
    cyan: 'text-neon-cyan',
    purple: 'text-neon-purple',
  };

  return (
    <div className={`hud-panel rounded-lg p-5 border ${colorMap[color]} transition-colors duration-200`}>
      <div className={`${iconColorMap[color]} mb-3`}>{icon}</div>
      <h4 className="text-sm font-[Orbitron] font-semibold text-foreground mb-2">{title}</h4>
      <p className="text-xs font-[Rajdhani] text-muted-foreground leading-relaxed">{description}</p>
    </div>
  );
}
