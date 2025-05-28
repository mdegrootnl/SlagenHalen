'use client';

import { User } from '@/lib/db/schema';
import { createNewGameAction, listOpenGamesAction, joinGameAction } from '@/app/game/actions';
import { useActionState, useEffect, useState, useTransition, useCallback } from 'react'; // Added useTransition and useCallback
import { useRouter } from 'next/navigation';
import { useSocket } from '@/contexts/SocketContext';
import { toast } from 'sonner';

// Import Shadcn UI components
import { Button } from "@/components/ui/button"; // Assuming this path is correct
import { GlareCard } from "@/components/ui/glare-card"; // Import GlareCard
import { DottedBackground } from "@/components/ui/dotted-background"; // Import DottedBackground
import { PlusIcon, UsersIcon, CrownIcon, RefreshCwIcon, InfoIcon, AlertTriangleIcon } from 'lucide-react'; // Example icons, added InfoIcon and AlertTriangleIcon

// Helper function to get first name
const getFirstName = (fullName: string | null | undefined): string => {
  if (!fullName) return 'Gastheer'; // MODIFIED: Fallback for missing host names
  return fullName.split(' ')[0];
};

interface AuthenticatedLandingContentProps {
  user: User;
}

// Updated Type for the game object from listOpenGamesAction
interface OpenGameLobbyItem {
  id: number;
  name: string | null;
  imageUrl: string | null;
  hostName: string | null;
  playerCount: number;
  createdAt: string; // Date is already stringified by the action
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
  const [isPendingTransition, startTransition] = useTransition(); // Added useTransition hook
  const { socket } = useSocket(); // Get socket from context

  const [createGameState, createGameFormAction, createGamePending] = useActionState<GameActionState, FormData>(
    createNewGameAction, 
    initialGameActionState
  );

  // State for the join game action
  const [joinGameState, joinGameFormAction, joinGamePendingReal] = useActionState<GameActionState, FormData>(
    joinGameAction,
    initialGameActionState
  );
  const [joiningGameId, setJoiningGameId] = useState<number | null>(null);

  // Combine React's isPending from useTransition with useActionState's pending for UI
  // Note: joinGamePendingReal is the one from useActionState
  const joinGamePending = isPendingTransition || joinGamePendingReal;

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
        toast.error(result.error || "Ophalen open spellen mislukt."); // MODIFIED
      }
    } catch (error) {
      console.error("Failed to fetch open games (client-side):", error);
      const errorMessage = "Onverwachte fout bij ophalen spellen."; // MODIFIED
      setListGamesError(errorMessage);
      toast.error(errorMessage);
      setOpenGames([]);
    }
    setIsLoadingGames(false);
  }, []);

  useEffect(() => {
    fetchOpenGames(); // Fetch games on component mount
  }, [fetchOpenGames]);

  // Effect to listen for real-time game list updates
  useEffect(() => {
    if (socket) {
      const handleOpenGamesUpdated = (data?: { newGameId?: number }) => {
        console.log(`Lobby received 'openGamesUpdated' event. New game ID: ${data?.newGameId || 'N/A'}. Refreshing games list.`);
        toast.info('Lijst met open spellen bijgewerkt.'); // MODIFIED: User feedback
        fetchOpenGames(); // Re-fetch the list of open games
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
  }, [socket, fetchOpenGames]); // Dependencies: socket instance and fetchOpenGames callback

  const handleCreateGame = () => {
    // For createGame, if it also needs transition (e.g. if it were async and not just formAction)
    // you might wrap it too, but typically direct formAction to useActionState is fine.
    // For consistency or if issues arise, startTransition could be used here too.
    startTransition(() => {
        createGameFormAction(new FormData());
    });
  };

  const handleJoinGame = (gameId: number) => {
    setJoiningGameId(gameId);
    startTransition(() => { // Wrap the action call in startTransition
      const formData = new FormData();
      formData.append('gameSessionId', gameId.toString());
      joinGameFormAction(formData);
    });
  };

  useEffect(() => {
    // Added detailed logging for createGameState effect
    console.log("[AuthenticatedLandingContent] createGameState changed:", JSON.stringify(createGameState));

    if (createGameState.success && createGameState.gameSessionId) {
      console.log(`[AuthenticatedLandingContent] Game creation success. GameSessionId: ${createGameState.gameSessionId}. Preparing to navigate.`);
      toast.success(createGameState.success || `Spel ${createGameState.gameSessionId} aangemaakt!`); // MODIFIED
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
      toast.error(createGameState.error || "Fout bij aanmaken spel."); // MODIFIED
    }
  }, [createGameState, router, socket, fetchOpenGames]); // Added socket and fetchOpenGames to dependency array

  useEffect(() => {
    // Added detailed logging for joinGameState effect
    console.log("[AuthenticatedLandingContent] joinGameState changed:", JSON.stringify(joinGameState));
    console.log(`[AuthenticatedLandingContent] Current joiningGameId state: ${joiningGameId}`);

    if (joinGameState.success && joinGameState.gameSessionId) {
      console.log(`[AuthenticatedLandingContent] Game join success. GameSessionId: ${joinGameState.gameSessionId}. Preparing to navigate.`);
      toast.success(joinGameState.success || `Deelgenomen aan spel ${joinGameState.gameSessionId}!`); // MODIFIED
      fetchOpenGames(); // Refresh list
      setJoiningGameId(null); // Reset joining game ID
      console.log(`[AuthenticatedLandingContent] Navigating to /game/${joinGameState.gameSessionId}/lobby...`);
      router.push(`/game/${joinGameState.gameSessionId}/lobby`);
    }
    if (joinGameState.error) {
      console.error(`[AuthenticatedLandingContent] Game join error for game ID ${joiningGameId}:`, joinGameState.error);
      toast.error(joinGameState.error || "Fout bij deelnemen aan spel."); // MODIFIED
      setJoiningGameId(null); // Reset joining game ID even on error
    }
  }, [joinGameState, router, fetchOpenGames, joiningGameId]); // Added fetchOpenGames and joiningGameId

  // Placeholder for rotating background. This would ideally be in a layout component.
  // For now, just a conceptual div.
  // const RotatingBackground = () => (
  //   <div className="fixed inset-0 -z-10 h-full w-full bg-gradient-to-br from-indigo-900 via-purple-900 to-slate-900">
  //     {/* Add rotating image logic here if doing it client-side, or set via CSS/server */}
  //   </div>
  // );

  return (
    <>
      {/* <RotatingBackground /> */}
      <DottedBackground 
        dotColor="#1e293b" // slate-800
        backgroundColor="transparent" // Changed from #0f172a to transparent
        dotSize={1.5}
        dotSpacing={25}
        vignetteColor="#020617" // slate-950
        innerGlowColor="#334155" // slate-700
        className="fixed inset-0 -z-10" // Reverted z-50 to -z-10
      />
      <div className="container mx-auto px-4 py-4 sm:py-6 text-white min-h-screen flex flex-col items-center"> {/* Removed relative z-0 */}
        
        {/* Profile Avatar - Assuming you have a component for this or integrate it here */}
        {/* <div className="absolute top-4 right-4"> <UserProfileAvatar user={user} /> </div> */}
        
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-center mt-6 mb-1" style={{fontFamily: 'serif'}}> {/* Example font */}

        </h1>
        <p className="text-base sm:text-lg text-purple-300 text-center mb-6 sm:mb-8 italic">
 
        </p>

        <Button 
          onClick={handleCreateGame} 
          disabled={createGamePending || joinGamePending || isLoadingGames}
          className="bg-purple-600 hover:bg-purple-700 text-white font-semibold py-2.5 px-5 sm:py-3 sm:px-6 rounded-lg text-base shadow-lg transform hover:scale-105 transition-transform duration-150 ease-in-out mb-8 sm:mb-10"
        >
          <PlusIcon className="mr-2 h-5 w-5" />
          {createGamePending ? 'Spel aanmaken...' : 'Nieuw Spel Starten'} {/* MODIFIED (already partially Dutch) */}
        </Button>

        <div className="w-full max-w-xs sm:max-w-sm md:max-w-md lg:max-w-lg">
          <div className="flex justify-between items-center mb-2 sm:mb-3">
            <h2 className="text-lg sm:text-xl font-semibold text-purple-200">OPEN SPELLEN</h2>
            <Button onClick={fetchOpenGames} disabled={isLoadingGames || createGamePending || joinGamePending} variant="outline" size="sm" className="text-purple-300 border-purple-400 hover:bg-purple-800 hover:text-white text-xs px-2 py-1">
              <RefreshCwIcon className={`mr-1 h-3 w-3 ${isLoadingGames ? 'animate-spin' : ''}`} />
              {isLoadingGames ? 'Verversen...' : 'Ververs'} {/* Already Dutch */}
            </Button>
          </div>

          {listGamesError && <p className="text-red-400 text-center mb-3 text-xs sm:text-sm">Fout bij laden spellen: {listGamesError}</p>} {/* MODIFIED */}
          
          {isLoadingGames && <p className="text-purple-300 text-center text-xs sm:text-sm">Open spellen laden...</p>} {/* MODIFIED */}
          
          {!isLoadingGames && openGames.length === 0 && !listGamesError && (
            <p className="text-purple-300 text-center py-6 sm:py-8 text-xs sm:text-sm">Geen open spellen gevonden. Waarom start je er geen?</p> /* MODIFIED */
          )}
          
          {!isLoadingGames && openGames.length > 0 && (
            <div className="flex flex-col items-center space-y-3 sm:space-y-4">
              {openGames.map((game) => (
                <div key={game.id} className="w-full glare-card-container" onClick={() => game.playerCount < 4 && handleJoinGame(game.id)}>
                  <GlareCard 
                    className="w-full h-[277px] p-3 sm:p-4 flex flex-col justify-between items-start relative cursor-pointer"
                    imageUrl={game.imageUrl || cityImageUrls[game.id % cityImageUrls.length]}
                  >
                    <div className="absolute inset-0 bg-black/40 z-0"></div> {/* Overlay for text readability */}
                    <div className="relative z-10 w-full">
                      <h3 className="text-xl sm:text-2xl font-bold text-slate-50 text-shadow text-center mb-2 truncate" title={game.name || 'Unnamed Game'}>{game.name || 'Onbenoemd Spel'}</h3>
                      <div className="text-xs sm:text-sm">
                        <p className="text-slate-100 text-shadow mb-1"><CrownIcon className="inline mr-1.5 h-3.5 w-3.5 sm:h-4 sm:w-4 text-yellow-300" />Gehost door: {getFirstName(game.hostName)}</p> {/* MODIFIED */}
                        <p className="text-slate-100 text-shadow mb-1"><UsersIcon className="inline mr-1.5 h-3.5 w-3.5 sm:h-4 sm:w-4 text-sky-300" />Spelers: {game.playerCount}/4</p> {/* MODIFIED */}
                        <p className="text-slate-100 text-shadow"><InfoIcon className="inline mr-1.5 h-3.5 w-3.5 sm:h-4 sm:w-4 text-gray-300" />Aangemaakt: {new Date(game.createdAt).toLocaleDateString()}</p> {/* MODIFIED */}
                      </div>
                    </div>
                    
                    {game.playerCount >= 4 && (
                      <div className="absolute inset-0 bg-red-700/80 flex items-center justify-center z-20">
                        <p className="text-white text-xl sm:text-2xl font-bold flex items-center"><AlertTriangleIcon className="h-6 w-6 mr-2" /> SPEL VOL</p> {/* MODIFIED */}
                      </div>
                    )}

                    {/* Conditional rendering for JOINING state for this specific card */}
                    {joiningGameId === game.id && joinGamePending && game.playerCount < 4 && (
                        <div className="absolute inset-0 bg-sky-600/90 flex items-center justify-center z-20">
                            <p className="text-white text-lg sm:text-xl font-semibold animate-pulse">Deelnemen...</p> {/* MODIFIED */}
                        </div>
                    )}
                  </GlareCard>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* <div className="mt-auto pt-8 pb-4 text-center text-sm text-purple-400">
          Welcome, {getFirstName(user.name)}! Your User ID: {user.id}
        </div> */}

      </div>
    </>
  );
} 