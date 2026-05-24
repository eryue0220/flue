import type {
	ChannelEventMap,
	ChannelEventContext,
	ChannelListener,
	ChannelOptions,
	DefinedChannel,
	WorkflowChannel,
} from './types.ts';

export function http(): WorkflowChannel<'http'> {
	return { __flueChannel: true, name: 'http' };
}

export function websocket(): WorkflowChannel<'websocket'> {
	return { __flueChannel: true, name: 'websocket' };
}

export function defineChannel<TEvents extends ChannelEventMap, TThread>(
	options: ChannelOptions<TEvents, TThread>,
): DefinedChannel<TEvents, TThread> {
	const listeners = new Map<string, Set<ChannelListener<unknown, TThread>>>();
	return {
		__flueDefinedChannel: true,
		app: options.app,
		on(type, listener) {
			let registered = listeners.get(type);
			if (!registered) {
				registered = new Set();
				listeners.set(type, registered);
			}
			const registeredListener = listener as ChannelListener<unknown, TThread>;
			registered.add(registeredListener);
			return () => {
				registered.delete(registeredListener);
				if (registered.size === 0) listeners.delete(type);
			};
		},
		async emit(type, ctx) {
			const registered = [...(listeners.get(type) ?? [])];
			const settled = await Promise.allSettled(registered.map((listener) => Promise.resolve().then(() => listener(ctx as ChannelEventContext<unknown, TThread>))));
			return {
				invoked: registered.length,
				errors: settled.flatMap((result) => result.status === 'rejected' ? [result.reason] : []),
			};
		},
	};
}
