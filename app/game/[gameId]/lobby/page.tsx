'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getGameLobbyInfoAction } from '../../actions'; // Path to game actions
import { Button } from '@/components/ui/button';
import { toast } from 'sonner'; // Import Sonner's toast function

// Helper function to get first name
const getFirstName = (fullName: string | null | undefined): string => {
  if (!fullName) return 'Speler'; // MODIFIED: Player -> Speler
  return fullName.split(' ')[0];
};

// Define a type for the game lobby information
interface PlayerInfo {
  id: number;
  userId: number;
  playerOrder: number;
  currentScore: number;
  userName: string;
}

interface GameLobbyInfo {
  id: number;
  name: string | null;
  status: string;
  currentRound: number | null;
  trumpSuit: string | null;
  createdAt: string;
  updatedAt: string;
  currentDealerId: number | null;
  currentTurnGamePlayerId: number | null;
  players: PlayerInfo[];
}

// Explicitly type the action result for better type narrowing
type GameLobbyActionResult = 
  | { success: true; gameLobbyInfo: GameLobbyInfo; error?: undefined }
  | { success?: undefined; gameLobbyInfo?: undefined; error: string };

export default function GameLobbyPage() {
  const router = useRouter();
  const params = useParams();
  const gameId = Number(params.gameId);

  const [lobbyInfo, setLobbyInfo] = useState<GameLobbyInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedStatus, setLastFetchedStatus] = useState<string | null>(null);

  const fetchLobbyInfo = useCallback(async () => {
    if (!gameId || isNaN(gameId)) {
      setError('Ongeldig spel-ID.'); // MODIFIED
      setIsLoading(false);
      return;
    }
    // Don't set isLoading true here if it's a background poll, 
    // only for the initial load or manual refresh.
    // setIsLoading(true); 

    let result: GameLobbyActionResult | null = null;
    try {
      const formData = new FormData();
      formData.append('gameId', gameId.toString());
      
      // Pass null for prevState, and the constructed FormData
      result = await getGameLobbyInfoAction(null as any, formData) as GameLobbyActionResult;

      if (result.error) {
        setError(result.error);
        toast.error(result.error); // Use Sonner toast.error (Potentially needs server-side translation)
      } else if (result.success && result.gameLobbyInfo) {
        setLobbyInfo(result.gameLobbyInfo);
        setLastFetchedStatus(result.gameLobbyInfo.status);
        setError(null);
        if (result.gameLobbyInfo.status === 'active' || 
            (result.gameLobbyInfo.status === 'bidding' && result.gameLobbyInfo.currentRound === 1)) {
          toast.success(`Spel ${gameId} is klaar! Navigeren...`); // MODIFIED
          router.push(`/game/${gameId}`);
        }
      } else {
        const unknownError = 'Ophalen lobbyinformatie mislukt door onverwachte serverreactie.'; // MODIFIED
        setError(unknownError);
        toast.error(unknownError);
      }
    } catch (e: any) {
      const clientError = 'Onverwachte client-fout bij ophalen lobbydata.'; // MODIFIED
      setError(clientError);
      toast.error(clientError);
      console.error("Client-side error in fetchLobbyInfo:", e);
    } finally {
      // Only set isLoading to false if we are not about to navigate due to game being active
      // Check against the status from *this* fetch attempt if possible
      const currentStatus = result?.success ? result.gameLobbyInfo.status : lastFetchedStatus;
      if (currentStatus !== 'active') {
        setIsLoading(false);
      }
    }
  }, [gameId, router, lastFetchedStatus]);

  useEffect(() => {
    setIsLoading(true); // Set loading true for the initial fetch
    fetchLobbyInfo(); 

    let intervalId: NodeJS.Timeout | undefined = undefined;
    // Use lastFetchedStatus to decide on polling to avoid race conditions with lobbyInfo state update
    if (lastFetchedStatus === 'pending' || 
        (lastFetchedStatus === 'active' && lobbyInfo?.currentRound === 1) ) { // continue polling if active but not yet round 1 (edge case, but safe)
        intervalId = setInterval(() => {
        console.log('Polling for lobby info...');
        if (!document.hidden) { 
            fetchLobbyInfo();
        }
      }, 5000); 
    }
    
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [fetchLobbyInfo, lastFetchedStatus]); 

  if (isLoading && !lobbyInfo) { 
    return <div className="container mx-auto p-4">Lobbyinformatie laden...</div>; // MODIFIED
  }

  if (error && !lobbyInfo) { // Show error prominently if no lobby info could be loaded at all
    return <div className="container mx-auto p-4 text-red-500">Fout: {error} <Button onClick={() => { setIsLoading(true); fetchLobbyInfo();}} className="ml-2">Opnieuw proberen</Button></div>; // MODIFIED
  }
  
  // If game is active, navigation should occur. This is a fallback message.
  if (lobbyInfo?.status === 'active') {
    return <div className="container mx-auto p-4">Spel is actief! Navigeren...</div>; // MODIFIED
  }
  
  if (!lobbyInfo) {
    // This state could be hit if initial load failed but error wasn't blocking enough, or some other edge case.
    return (
        <div className="container mx-auto p-4">
            <p>Geen lobbyinformatie beschikbaar. Dit is mogelijk een tijdelijk probleem.</p> {/* MODIFIED */}
            <Button onClick={() => { setIsLoading(true); fetchLobbyInfo();}} className="mt-2">
                Lobbyinformatie Opnieuw Ophalen {/* MODIFIED */}
            </Button>
        </div>
    );
  }

  return (
    <div className="container mx-auto p-4 text-slate-200">
      {error && <p className="text-red-300 bg-red-900/50 p-3 rounded mb-4">Laatste poging tot vernieuwen mislukt: {error}</p>} {/* MODIFIED */}
      <h1 className="text-3xl font-bold mb-4 text-slate-50">{lobbyInfo.name || `Spellobby - ID: ${lobbyInfo.id}`}</h1> {/* MODIFIED */}
      <p className="mb-2 text-slate-300">Status: <span className={`font-semibold ${lobbyInfo.status === 'pending' ? 'text-yellow-400' : 'text-green-400'}`}>{lobbyInfo.status}</span></p>
      <p className="mb-4 text-slate-300">Aangemaakt op: {new Date(lobbyInfo.createdAt).toLocaleString()}</p> {/* MODIFIED */}

      <h2 className="text-2xl font-semibold mb-3 text-slate-100">Spelers ({lobbyInfo.players.length}/4):</h2> {/* MODIFIED */}
      {lobbyInfo.players.length > 0 ? (
        <ul className="list-none pl-0 mb-4 space-y-1">
          {lobbyInfo.players.map((player) => (
            <li key={player.id} className="mb-1 text-slate-200 bg-slate-700/50 p-2 rounded">
              {getFirstName(player.userName)} (Volgorde: {player.playerOrder + 1}){/* MODIFIED */}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 text-slate-400 italic">Nog geen spelers deelgenomen.</p> /* MODIFIED */
      )}

      {lobbyInfo.players.length < 4 && lobbyInfo.status === 'pending' && (
        <div className="mt-6 p-4 border border-dashed border-slate-600 rounded-md bg-slate-800/50">
          <p className="text-xl font-semibold text-center text-slate-100">Wachten op andere spelers...</p> {/* MODIFIED */}
          <p className="text-sm text-slate-400 text-center mt-2">Het spel start automatisch zodra 4 spelers zijn toegetreden.</p> {/* MODIFIED */}
        </div>
      )}
      
      {lobbyInfo.status !== 'pending' && lobbyInfo.status !== 'active' && (
         <p className="text-lg font-semibold text-orange-400">Spelstatus: {lobbyInfo.status}. Momenteel niet deelneembaar of in lobbyfase.</p> /* MODIFIED */
      )}

      <Button onClick={() => router.push('/')} variant="outline" className="mt-8 border-slate-500 text-slate-200 hover:bg-slate-700 hover:text-slate-50">
        Terug naar Startpagina {/* MODIFIED */}
      </Button>
      <Button onClick={() => { setIsLoading(true); fetchLobbyInfo();}} disabled={isLoading && lobbyInfo !== null} className="mt-8 ml-3 bg-slate-600 hover:bg-slate-500 text-slate-50">
        {isLoading && lobbyInfo !== null ? 'Vernieuwen...' : 'Lobby Vernieuwen'}  {/* MODIFIED */}
      </Button>
    </div>
  );
} 