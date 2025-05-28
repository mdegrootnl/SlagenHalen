'use client';

import { User } from '@/lib/db/schema';
import { createNewGameAction, listOpenGamesAction, joinGameAction } from '@/app/game/actions';
import { useEffect, useState, useTransition, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSocket } from '@/contexts/SocketContext';
import { toast } from 'sonner';

// Import Shadcn UI components
import { Button } from "@/components/ui/button";
import { GlareCard } from "@/components/ui/glare-card";
import { DottedBackground } from "@/components/ui/dotted-background";
import { PlusIcon, UsersIcon, CrownIcon, RefreshCwIcon, InfoIcon, AlertTriangleIcon } from 'lucide-react';

// Helper function to get first name
const getFirstName = (fullName: string | null | undefined): string => {
  if (!fullName) return 'Gastheer';
  return fullName.split(' ')[0];
};

interface AuthenticatedLandingContentProps {
  user: User;
}

interface OpenGameLobbyItem {
  id: number;
  name: string | null;
  imageUrl: string | null;
  hostName: string | null;
  playerCount: number;
  createdAt: string;
}

interface GameActionState {
  error?: string;
  success?: string;
  gameSessionId?: number;
  [key: string]: any;
}

const initialGameActionState: GameActionState = {
  error: undefined,
  success: undefined,
  gameSessionId: undefined,
};

const cityImageUrls = [
  "/images/cities/vienna_sw.png",
  "/images/cities/naples_sw.png",
  "/images/cities/dubrovnik_sw.png",
  "/images/cities/prague_sw.png",
  "/images/cities/ghent_sw.png",
  "/images/cities/lisbon_sw.png",
  "/images/cities/berlin_sw.png",
  "/images/cities/istanbul_sw.png",
  "/images/cities/strasbourg_sw.png",
  "/images/cities/liverpool_sw.png",
];

export default function AuthenticatedLandingContent({ user }: AuthenticatedLandingContentProps) {
  const router = useRouter();
  const { socket } = useSocket();

  const [createGameState, setCreateGameState] = useState<GameActionState>(initialGameActionState);
  const [isCreateGamePending, startCreateGameTransition] = useTransition();

  const [joinGameState, setJoinGameState] = useState<GameActionState>(initialGameActionState);
  const [isJoinGamePending, startJoinGameTransition] = useTransition();
  const [joiningGameId, setJoiningGameId] = useState<number | null>(null);

  const [openGames, setOpenGames] = useState<OpenGameLobbyItem[]>([]);
  const [listGamesError, setListGamesError] = useState<string | null>(null);
  const [isLoadingGames, setIsLoadingGames] = useState(false);

  const fetchOpenGames = useCallback(async () => {
    setIsLoadingGames(true);
    setListGamesError(null);
    try {
      const result = await listOpenGamesAction();
      if (result.success && result.games) {
        setOpenGames(result.games as OpenGameLobbyItem[]);
      } else if (result.error) {
        setListGamesError(result.error);
        setOpenGames([]);
        toast.error(result.error || "Ophalen open spellen mislukt.");
      }
    } catch (error) {
      console.error("Failed to fetch open games (client-side):", error);
      const errorMessage = "Onverwachte fout bij ophalen spellen.";
      setListGamesError(errorMessage);
      toast.error(errorMessage);
      setOpenGames([]);
    }
    setIsLoadingGames(false);
  }, []);

  useEffect(() => {
    fetchOpenGames();
  }, [fetchOpenGames]);

  useEffect(() => {
    if (socket) {
      const handleOpenGamesUpdated = (data?: { newGameId?: number }) => {
        console.log(`Lobby received 'openGamesUpdated' event. New game ID: ${data?.newGameId || 'N/A'}. Refreshing games list.`);
        toast.info('Lijst met open spellen bijgewerkt.');
        fetchOpenGames();
      };
      socket.on('openGamesUpdated', handleOpenGamesUpdated);
      console.log("[AuthenticatedLandingContent] Socket listener for 'openGamesUpdated' attached.");
      return () => {
        socket.off('openGamesUpdated', handleOpenGamesUpdated);
        console.log("[AuthenticatedLandingContent] Socket listener for 'openGamesUpdated' detached.");
      };
    } else {
      console.log("[AuthenticatedLandingContent] Socket not available, cannot attach 'openGamesUpdated' listener.");
    }
  }, [socket, fetchOpenGames]);

  const handleCreateGameSubmit = () => {
    startCreateGameTransition(() => {
      // Optional: Clear previous success/error for this specific action
      // setCreateGameState(prev => ({ ...initialGameActionState, gameSessionId: prev.gameSessionId }));
    });
    createNewGameAction(createGameState, new FormData())
      .then(setCreateGameState)
      .catch(error => {
        console.error("Create game failed:", error);
        setCreateGameState({ error: "Fout bij aanmaken spel.", success: undefined });
      });
  };

  const handleJoinGame = (gameId: number) => {
    setJoiningGameId(gameId);
    startJoinGameTransition(() => {
      // Optional: Clear previous success/error for this specific action
      // setJoinGameState(prev => ({ ...initialGameActionState, gameSessionId: prev.gameSessionId }));
    });
    const formData = new FormData();
    formData.append('gameSessionId', gameId.toString());
    joinGameAction(joinGameState, formData) 
      .then(setJoinGameState)
      .catch(error => {
        console.error("Join game failed for game ID", gameId, error);
        setJoinGameState({ error: "Fout bij deelnemen aan spel.", success: undefined });
      });
  };

  useEffect(() => {
    console.log("[AuthenticatedLandingContent] createGameState changed:", JSON.stringify(createGameState));
    if (createGameState.success && createGameState.gameSessionId) {
      console.log(`[AuthenticatedLandingContent] Game creation success. GameSessionId: ${createGameState.gameSessionId}. Preparing to navigate.`);
      toast.success(createGameState.success || `Spel ${createGameState.gameSessionId} aangemaakt!`);
      if (socket) {
        console.log("[AuthenticatedLandingContent] Socket connected, emitting 'clientNewGameCreated'.");
        socket.emit('clientNewGameCreated', { newGameId: createGameState.gameSessionId });
      } else {
        console.log("[AuthenticatedLandingContent] Socket NOT connected, calling fetchOpenGames() as fallback.");
        fetchOpenGames();
      }
      console.log(`[AuthenticatedLandingContent] Navigating to /game/${createGameState.gameSessionId}/lobby...`);
      router.push(`/game/${createGameState.gameSessionId}/lobby`);
    }
    if (createGameState.error) {
      console.error("[AuthenticatedLandingContent] Game creation error:", createGameState.error);
      toast.error(createGameState.error || "Fout bij aanmaken spel.");
    }
  }, [createGameState, router, socket, fetchOpenGames]);

  useEffect(() => {
    console.log("[AuthenticatedLandingContent] joinGameState changed:", JSON.stringify(joinGameState));
    console.log(`[AuthenticatedLandingContent] Current joiningGameId state: ${joiningGameId}`);
    if (joinGameState.success && joinGameState.gameSessionId) {
      console.log(`[AuthenticatedLandingContent] Game join success. GameSessionId: ${joinGameState.gameSessionId}. Preparing to navigate.`);
      toast.success(joinGameState.success || `Deelgenomen aan spel ${joinGameState.gameSessionId}!`);
      fetchOpenGames();
      setJoiningGameId(null);
      console.log(`[AuthenticatedLandingContent] Navigating to /game/${joinGameState.gameSessionId}/lobby...`);
      router.push(`/game/${joinGameState.gameSessionId}/lobby`);
    }
    if (joinGameState.error) {
      console.error(`[AuthenticatedLandingContent] Game join error for game ID ${joiningGameId}:`, joinGameState.error);
      toast.error(joinGameState.error || "Fout bij deelnemen aan spel.");
      setJoiningGameId(null);
    }
  }, [joinGameState, router, fetchOpenGames, joiningGameId]);

  return (
    <>
      <DottedBackground
        dotColor="#1e293b"
        backgroundColor="transparent"
        dotSize={1.5}
        dotSpacing={25}
        vignetteColor="#020617"
        innerGlowColor="#334155"
        className="fixed inset-0 -z-10"
      />
      <div className="container mx-auto px-4 py-4 sm:py-6 text-white min-h-screen flex flex-col items-center">
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-center mt-6 mb-1" style={{ fontFamily: 'serif' }}>
        </h1>
        <p className="text-base sm:text-lg text-purple-300 text-center mb-6 sm:mb-8 italic">
        </p>

        <Button
          onClick={handleCreateGameSubmit}
          disabled={isCreateGamePending || isJoinGamePending || isLoadingGames}
          className="bg-purple-600 hover:bg-purple-700 text-white font-semibold py-2.5 px-5 sm:py-3 sm:px-6 rounded-lg text-base shadow-lg transform hover:scale-105 transition-transform duration-150 ease-in-out mb-8 sm:mb-10"
        >
          <PlusIcon className="mr-2 h-5 w-5" />
          {isCreateGamePending ? 'Spel aanmaken...' : 'Nieuw Spel Starten'}
        </Button>

        <div className="w-full max-w-xs sm:max-w-sm md:max-w-md lg:max-w-lg">
          <div className="flex justify-between items-center mb-2 sm:mb-3">
            <h2 className="text-lg sm:text-xl font-semibold text-purple-200">OPEN SPELLEN</h2>
            <Button onClick={fetchOpenGames} disabled={isLoadingGames || isCreateGamePending || isJoinGamePending} variant="outline" size="sm" className="text-purple-300 border-purple-400 hover:bg-purple-800 hover:text-white text-xs px-2 py-1">
              <RefreshCwIcon className={`mr-1 h-3 w-3 ${isLoadingGames ? 'animate-spin' : ''}`} />
              {isLoadingGames ? 'Verversen...' : 'Ververs'}
            </Button>
          </div>

          {listGamesError && <p className="text-red-400 text-center mb-3 text-xs sm:text-sm">Fout bij laden spellen: {listGamesError}</p>}
          {isLoadingGames && <p className="text-purple-300 text-center text-xs sm:text-sm">Open spellen laden...</p>}
          {!isLoadingGames && openGames.length === 0 && !listGamesError && (
            <p className="text-purple-300 text-center py-6 sm:py-8 text-xs sm:text-sm">Geen open spellen gevonden. Waarom start je er geen?</p>
          )}
          {!isLoadingGames && openGames.length > 0 && (
            <div className="flex flex-col items-center space-y-3 sm:space-y-4 w-full">
              {openGames.map((game) => (
                <div 
                  key={game.id} 
                  className="w-full glare-card-container cursor-pointer group" 
                  onClick={() => {
                    if (game.playerCount < 4 && !(joiningGameId === game.id && isJoinGamePending)) {
                      handleJoinGame(game.id);
                    }
                  }}
                >
                  <GlareCard
                    className="w-full min-h-[180px] sm:min-h-[200px] md:min-h-[220px] p-3 sm:p-4 flex flex-col justify-between items-start relative border border-slate-800 rounded-[var(--radius)] hover:[--duration:200ms] hover:[--easing:linear] hover:filter-none overflow-hidden"
                    imageUrl={game.imageUrl || cityImageUrls[game.id % cityImageUrls.length]}
                  >
                    {/* Overlay for text readability - semi-transparent black */}
                    <div className="absolute inset-0 bg-black/50 z-0 rounded-[var(--radius)] group-hover:bg-black/60 transition-colors duration-300"></div>
                    
                    {/* Content container */}
                    <div className="relative z-10 w-full flex flex-col flex-grow h-full">
                      {/* Game Name */}
                      <h3 className="text-lg sm:text-xl md:text-2xl font-bold text-slate-50 text-shadow text-center mb-2 truncate" title={game.name || 'Unnamed Game'}>
                        {game.name || `Spel van ${getFirstName(game.hostName)}`}
                      </h3>
                      
                      {/* Game Info - Takes remaining space */}
                      <div className="text-xs sm:text-sm space-y-1 mt-1 flex-grow">
                        <p className="text-slate-200 text-shadow flex items-center">
                          <CrownIcon className="inline mr-1.5 h-3.5 w-3.5 sm:h-4 sm:w-4 text-yellow-400" />Gastheer: {getFirstName(game.hostName)}
                        </p>
                        <p className="text-slate-200 text-shadow flex items-center">
                          <UsersIcon className="inline mr-1.5 h-3.5 w-3.5 sm:h-4 sm:w-4 text-sky-300" />Spelers: {game.playerCount}/4
                        </p>
                        <p className="text-slate-200 text-shadow flex items-center">
                          <InfoIcon className="inline mr-1.5 h-3.5 w-3.5 sm:h-4 sm:w-4 text-gray-400" />Aangemaakt: {new Date(game.createdAt).toLocaleDateString()}
                        </p>
                      </div>

                      {/* Button or Status Display Area - Aligned to bottom of this z-10 container */}
                      <div className="mt-auto w-full flex justify-center pt-2">
                        {game.playerCount < 4 && !(joiningGameId === game.id && isJoinGamePending) && (
                          <Button
                            size="sm"
                            variant="default"
                            onClick={(e) => { 
                              e.stopPropagation(); // Prevent card click when button is clicked
                              handleJoinGame(game.id); 
                            }}
                            disabled={isJoinGamePending || isCreateGamePending || isLoadingGames} // Global pending states
                            className="bg-green-500 hover:bg-green-600 text-white font-semibold py-2 px-4 rounded-md text-sm shadow-lg transform group-hover:scale-105 transition-all duration-150 ease-in-out"
                          >
                            DEELNEMEN
                          </Button>
                        )}
                        {game.playerCount >= 4 && (
                           <div className="w-full text-center py-2 px-4 rounded-md bg-red-700/80 text-white text-sm font-semibold flex items-center justify-center">
                             <AlertTriangleIcon className="h-4 w-4 mr-1.5" /> SPEL VOL
                           </div>
                        )}
                        {joiningGameId === game.id && isJoinGamePending && game.playerCount < 4 && (
                          <div className="w-full text-center py-2 px-4 rounded-md bg-sky-500/90 text-white text-sm font-semibold flex items-center justify-center animate-pulse">
                             DEELNEMEN...
                          </div>
                        )}
                      </div>
                    </div>
                  </GlareCard>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
} 