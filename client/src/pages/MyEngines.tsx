import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { ArrowLeft, Plus, Trash2, Share2, Loader2, Play, Copy, Pencil } from "lucide-react";
import { toast } from "sonner";
import { startLogin } from "@/const";

export default function MyEngines() {
  const { isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();

  const { data: configs, isLoading } = trpc.engine.myConfigs.useQuery(undefined, { enabled: isAuthenticated });
  const utils = trpc.useUtils();

  const deleteMutation = trpc.engine.delete.useMutation({
    onSuccess: () => {
      utils.engine.myConfigs.invalidate();
      toast.success('Engine deleted');
    },
  });

  const publishMutation = trpc.community.publish.useMutation({
    onSuccess: () => {
      utils.engine.myConfigs.invalidate();
      toast.success('Engine published to community!');
    },
  });

  const duplicateMutation = trpc.engine.duplicate.useMutation({
    onSuccess: () => {
      utils.engine.myConfigs.invalidate();
      toast.success('Engine duplicated!');
    },
  });

  const renameMutation = trpc.engine.rename.useMutation({
    onSuccess: () => {
      utils.engine.myConfigs.invalidate();
      toast.success('Engine renamed!');
    },
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-dark-bg flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-neon-cyan" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-dark-bg flex flex-col items-center justify-center gap-4">
        <p className="text-sm font-[Rajdhani] text-muted-foreground">Sign in to view your saved engines</p>
        <Button onClick={() => startLogin()} variant="outline" className="border-neon-cyan/40 text-neon-cyan">
          Sign In
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-dark-bg">
      <header className="border-b border-hud-line/30 bg-dark-surface/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container flex items-center justify-between h-14">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate('/')} className="text-muted-foreground hover:text-neon-cyan">
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <h1 className="text-sm font-[Orbitron] font-bold text-neon-pink glow-pink uppercase tracking-wider">
              My Engines
            </h1>
          </div>
          <Button
            onClick={() => navigate('/simulator')}
            variant="outline"
            size="sm"
            className="text-xs font-[Rajdhani] border-neon-cyan/40 text-neon-cyan hover:bg-neon-cyan/10"
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            New Engine
          </Button>
        </div>
      </header>

      <main className="container py-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-neon-cyan" />
          </div>
        ) : configs && configs.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {configs.map((item) => {
              const cfg = item.config as any;
              return (
                <div key={item.id} className="hud-panel rounded-lg p-4 border border-hud-line/20 hover:border-neon-pink/30 transition-colors">
                  <div className="mb-3">
                    <h3 className="text-sm font-[Orbitron] font-semibold text-foreground">{item.name}</h3>
                    <p className="text-xs font-[Rajdhani] text-muted-foreground mt-1">{item.description || ''}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {cfg?.quick && (
                      <>
                        <span className="px-2 py-0.5 text-[10px] font-[JetBrains_Mono] text-neon-cyan/80 bg-neon-cyan/5 border border-neon-cyan/20 rounded">
                          {cfg.quick.cylinderCount}-Cyl
                        </span>
                        <span className="px-2 py-0.5 text-[10px] font-[JetBrains_Mono] text-neon-cyan/80 bg-neon-cyan/5 border border-neon-cyan/20 rounded">
                          {cfg.quick.layout}
                        </span>
                      </>
                    )}
                    {item.isPublic && (
                      <span className="px-2 py-0.5 text-[10px] font-[JetBrains_Mono] text-neon-pink/80 bg-neon-pink/5 border border-neon-pink/20 rounded">
                        Public
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between pt-3 border-t border-hud-line/10">
                    <span className="text-[10px] font-[Rajdhani] text-muted-foreground">
                      {new Date(item.updatedAt).toLocaleDateString()}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate(`/simulator?load=${item.id}`)}
                        className="h-7 px-2 text-xs text-neon-cyan hover:bg-neon-cyan/10"
                      >
                        <Play className="w-3.5 h-3.5 mr-1" />
                        Load
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => duplicateMutation.mutate({ id: item.id })}
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-neon-cyan"
                        title="Duplicate"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const newName = prompt('Rename engine:', item.name);
                          if (newName && newName.trim()) {
                            renameMutation.mutate({ id: item.id, name: newName.trim() });
                          }
                        }}
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-neon-cyan"
                        title="Rename"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      {!item.isPublic && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => publishMutation.mutate({ configId: item.id })}
                          className="h-7 px-2 text-xs text-muted-foreground hover:text-neon-cyan"
                        >
                          <Share2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteMutation.mutate({ id: item.id })}
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-20">
            <p className="text-sm font-[Rajdhani] text-muted-foreground">No saved engines yet.</p>
            <Button
              onClick={() => navigate('/simulator')}
              className="mt-4 font-[Rajdhani] border-neon-pink/40 text-neon-pink hover:bg-neon-pink/10"
              variant="outline"
              size="sm"
            >
              Create Your First Engine
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
