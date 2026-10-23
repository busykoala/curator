export class StalePlaylistProposalError extends Error{
  constructor(message:string){super(message);this.name='StalePlaylistProposalError'}
}
