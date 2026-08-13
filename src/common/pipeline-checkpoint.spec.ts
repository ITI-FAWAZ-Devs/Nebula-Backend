import {
  emptyCheckpoint,
  hasStage,
  markStage,
  fromPrismaJson,
  MAX_RESUME_COUNT,
} from './pipeline-checkpoint';

describe('pipeline-checkpoint helpers', () => {
  describe('emptyCheckpoint', () => {
    it('returns empty stages and artifacts', () => {
      const cp = emptyCheckpoint();
      expect(cp.completedStages).toEqual([]);
      expect(cp.artifacts).toEqual({});
    });
  });

  describe('hasStage', () => {
    it('returns false for empty checkpoint', () => {
      expect(hasStage(emptyCheckpoint(), 'clone')).toBe(false);
    });

    it('returns true when stage is present', () => {
      const cp = markStage(emptyCheckpoint(), 'clone');
      expect(hasStage(cp, 'clone')).toBe(true);
    });

    it('returns false for different stage', () => {
      const cp = markStage(emptyCheckpoint(), 'clone');
      expect(hasStage(cp, 'graphify')).toBe(false);
    });
  });

  describe('markStage', () => {
    it('appends a new stage', () => {
      const cp = markStage(emptyCheckpoint(), 'discovery');
      expect(cp.completedStages).toContain('discovery');
    });

    it('does not duplicate existing stage', () => {
      let cp = markStage(emptyCheckpoint(), 'clone');
      cp = markStage(cp, 'clone');
      expect(cp.completedStages.filter((s) => s === 'clone')).toHaveLength(1);
    });

    it('merges artifacts', () => {
      let cp = markStage(emptyCheckpoint(), 'graphify', {
        graphifyPath: '/tmp/graph.json',
      });
      cp = markStage(cp, 'normalize', { count: 42 });
      expect(cp.artifacts.graphifyPath).toBe('/tmp/graph.json');
      expect(cp.artifacts.count).toBe(42);
    });

    it('does not mutate original', () => {
      const original = emptyCheckpoint();
      markStage(original, 'clone');
      expect(original.completedStages).toHaveLength(0);
    });
  });

  describe('fromPrismaJson', () => {
    it('returns empty checkpoint for null', () => {
      const cp = fromPrismaJson(null);
      expect(cp).toEqual(emptyCheckpoint());
    });

    it('returns empty checkpoint for plain string', () => {
      const cp = fromPrismaJson('garbage');
      expect(cp).toEqual(emptyCheckpoint());
    });

    it('parses valid checkpoint shape', () => {
      const raw = {
        completedStages: ['clone', 'discovery'],
        artifacts: { localPath: '/tmp/repo' },
      };
      const cp = fromPrismaJson(raw);
      expect(cp.completedStages).toEqual(['clone', 'discovery']);
      expect(cp.artifacts.localPath).toBe('/tmp/repo');
    });

    it('tolerates missing artifacts key', () => {
      const raw = { completedStages: ['clone'] };
      const cp = fromPrismaJson(raw);
      expect(cp.artifacts).toEqual({});
    });

    it('tolerates missing completedStages key', () => {
      const raw = { artifacts: { foo: 'bar' } };
      const cp = fromPrismaJson(raw);
      expect(cp.completedStages).toEqual([]);
    });
  });

  describe('MAX_RESUME_COUNT', () => {
    it('is a positive integer', () => {
      expect(typeof MAX_RESUME_COUNT).toBe('number');
      expect(MAX_RESUME_COUNT).toBeGreaterThan(0);
    });
  });
});
