function toolDetail(name) {
    switch (name) {
        case 'read': return 'reading_files';
        case 'edit':
        case 'write': return 'editing_files';
        case 'bash':
        case 'powershell': return 'running_command';
        default: return 'using_tool';
    }
}
/** Stores only opaque active tool IDs, public categories, and the last emitted state. */
export function createActivityTracker(record) {
    const tools = new Map();
    let lastPhase;
    let lastDetail;
    function emit(phase, detail) {
        if (lastPhase === phase && lastDetail === detail)
            return;
        lastPhase = phase;
        lastDetail = detail;
        record(phase, detail);
    }
    function emitTools() {
        const detail = tools.size > 1 ? 'multiple_tools' : tools.values().next().value;
        if (detail)
            emit('tool', detail);
    }
    return {
        start() {
            tools.clear();
            emit('working', 'processing');
        },
        settled() {
            tools.clear();
            emit('idle', 'settled');
        },
        message(type) {
            if (tools.size)
                return;
            switch (type) {
                case 'thinking_start':
                case 'thinking_delta':
                    emit('thinking', 'thinking');
                    break;
                case 'thinking_end':
                    emit('working', 'processing');
                    break;
                case 'text_start':
                case 'text_delta':
                    emit('responding', 'responding');
                    break;
            }
        },
        toolStart(id, name) {
            tools.set(id, toolDetail(name));
            emitTools();
        },
        toolEnd(id) {
            if (!tools.delete(id))
                return;
            if (tools.size)
                emitTools();
            else
                emit('working', 'processing');
        },
        reset() {
            tools.clear();
            lastPhase = undefined;
            lastDetail = undefined;
        },
    };
}
//# sourceMappingURL=activity.js.map