import {identityName} from '@/features/integrations/navidrome-identity';
import type {ListenerSong} from './listening-snapshot';

export function listenerAlbumIdentity(song:Pick<ListenerSong,'album'|'artist'|'albumId'|'albumArtist'>){
  return song.albumId?'native:'+song.albumId:'text:'+identityName(song.albumArtist||song.artist)+'|'+identityName(song.album);
}
export function albumListeningHistory(songs:ListenerSong[]){
  const history=new Map<string,{lastPlayed:string|null;undatedPlays:boolean}>();
  for(const song of songs){
    if(!song.hasPlayed&&!song.playCount&&!song.lastPlayed)continue;
    const key=listenerAlbumIdentity(song),entry=history.get(key)??{lastPlayed:null,undatedPlays:false},at=Date.parse(song.lastPlayed??'');
    if(!Number.isFinite(at))entry.undatedPlays=true;
    else if(!entry.lastPlayed||at>Date.parse(entry.lastPlayed))entry.lastPlayed=song.lastPlayed;
    history.set(key,entry);
  }
  return history;
}
